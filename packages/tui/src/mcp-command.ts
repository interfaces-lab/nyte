import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { findRunningHost, hostFilePath } from "@nyte-ai/service/host-endpoint";
import type {
  Connection,
  Json,
  McpApi,
  McpChange,
  McpScope,
  McpServerConfig,
  McpServerState,
  McpServerView,
  McpView,
  WorkspaceId,
} from "@nyte-ai/sdk";
import { CliError } from "./cli/errors.ts";
import type { NextStep } from "./cli/errors.ts";
import { formatCommand, formatTable, printable } from "./cli/format.ts";
import type { Row } from "./cli/format.ts";
import { parseCommandArgs, readAction } from "./cli/options.ts";
import type { Output } from "./cli/output.ts";
import { cliLoginDriver } from "./interaction.ts";
import type { HostSource } from "./local-host.ts";
import { exposureName, target } from "./model/mcp.ts";
import { addFolder } from "./run.ts";
import { runLogin } from "./services/auth.ts";
import type { LoginDriver } from "./services/auth.ts";

const EXPOSURES = ["direct", "deferred", "codemode", "codemode-deferred", "hidden"] as const;

const LIST_WAIT_MS = 15_000;

const STDERR_LINES = 5;

const STATES: Readonly<Record<McpServerState["kind"], string>> = {
  connected: "connected",
  connecting: "connecting",
  disabled: "off",
  "needs-sign-in": "needs sign-in",
  failed: "failed",
};

const ADD_HELP: readonly NextStep[] = [
  { label: "See the options", argv: ["nyte", "mcp", "add", "--help"] },
];

const LIST: NextStep = { label: "See your servers", argv: ["nyte", "mcp", "list"] };

const UNREAD = {
  unregistered: {
    warning: "This folder's .nyte/mcp.json isn't read until Nyte opens the folder.",
    next: { label: "Open Nyte in this folder", argv: ["nyte"] },
  },
  untrusted: {
    warning: "This folder's .nyte/mcp.json isn't read until the folder is trusted.",
    next: { label: "Trust this folder", argv: ["nyte", "trust"] },
  },
} as const satisfies Record<string, { readonly warning: string; readonly next: NextStep }>;

const SECRET_OPTIONS = [
  { flag: "--header", placeholder: "<HEADER>" },
  { flag: "--env", placeholder: "<KEY=VALUE>" },
  { flag: "--oauth-client-secret", placeholder: "<SECRET>" },
] as const;

interface Input {
  readonly args: readonly string[];
  readonly connect: (source: HostSource) => Promise<Connection>;
  readonly signal: AbortSignal;
  readonly output: Output;
}

export async function mcpCommand(input: Input): Promise<number> {
  const found = readAction("mcp", input.args);
  const args = found.args;

  switch (found.action) {
    case "add":
      return add(args, input);
    case "remove":
      return remove(args, input);
    case "list":
      return list(args, input);
    case "login":
      return login(args, input);
    case "logout":
      return logout(args, input);
    default: {
      const _exhaustive: never = found.action;

      return _exhaustive;
    }
  }
}

async function add(args: readonly string[], input: Input): Promise<number> {
  const request = parseAdd(args);
  const mcp = await openWorkspace(input.connect, request.scope);

  const taken = (await firstView(mcp)).servers.find(
    (server) => server.name === request.server && server.scope === request.scope,
  );

  if (taken !== undefined && !request.force)
    throw new CliError(
      "conflict",
      `Can't add ${request.server}. ${request.scope === "user" ? "Your user mcp.json" : "This folder's .nyte/mcp.json"} already has it.`,
      {
        details: [
          { label: "Scope", value: taken.scope },
          { label: "Target", value: printable(target(taken)) },
        ],
        next: [replaceStep(args)],
      },
    );

  settle(await mcp.add(request.server, request.config, request.scope), "add", request.server);
  receipt(input.output, `Added ${request.server}`, request.server, [
    { label: "Scope", value: request.scope },
    ...(taken === undefined ? [] : [{ label: "Replaced", value: printable(target(taken)) }]),
  ]);
  nextStep(input.output, { label: "Check that it connects", argv: ["nyte", "mcp", "list"] });

  return 0;
}

async function remove(args: readonly string[], input: Input): Promise<number> {
  const parsed = parseCommandArgs("mcp", args, 1, "remove");

  const server = serverName(
    "remove",
    parsed.positionals,
    "Can't remove an MCP server without a name.",
  );

  const scope: McpScope = parsed.has("local") ? "project" : "user";
  const outcome = await (await openWorkspace(input.connect, scope)).remove(server, scope);

  if (outcome.kind === "missing")
    throw new CliError(
      "not_found",
      scope === "user"
        ? `Couldn't find MCP server ${server} in your user mcp.json.`
        : `Couldn't find MCP server ${server} in this folder's .nyte/mcp.json.`,
      {
        next: [
          LIST,
          scope === "user"
            ? {
                label: "Remove it from this folder's .nyte/mcp.json",
                argv: ["nyte", "mcp", "remove", server, "--local"],
              }
            : {
                label: "Remove it from your user mcp.json",
                argv: ["nyte", "mcp", "remove", server],
              },
        ],
      },
    );

  settle(outcome, "remove", server);
  receipt(input.output, `Removed ${server}`, server, [{ label: "Scope", value: scope }]);

  return 0;
}

async function logout(args: readonly string[], input: Input): Promise<number> {
  const server = serverName(
    "logout",
    parseCommandArgs("mcp", args, 1, "logout").positionals,
    "Can't sign out of an MCP server without a name.",
  );

  settle(await (await openWorkspace(input.connect)).logout(server), "sign out of", server);
  receipt(input.output, `Signed out of ${server}`, server, []);

  return 0;
}

async function list(args: readonly string[], input: Input): Promise<number> {
  const parsed = parseCommandArgs("mcp", args, 0, "list");
  const found = await listedWorkspace(input.connect);
  const read = await settled(found.mcp, input.signal, (phase) => input.output.progress(phase));

  const view =
    found.folder === "unregistered"
      ? { ...read, servers: read.servers.filter((server) => server.scope === "user") }
      : read;

  if (parsed.has("json")) input.output.json(listDocument(view));
  else showList(view, input.output);

  if (
    found.folder !== "trusted" &&
    process.cwd() !== homedir() &&
    existsSync(join(process.cwd(), ".nyte", "mcp.json"))
  ) {
    const unread = UNREAD[found.folder];
    input.output.say("");
    input.output.status("warn", unread.warning);
    nextStep(input.output, unread.next);
  }

  const failing =
    view.issues.length > 0 ||
    view.servers.some(
      (server) => server.state.kind !== "connected" && server.state.kind !== "disabled",
    );

  return failing ? 1 : 0;
}

async function login(args: readonly string[], input: Input): Promise<number> {
  const named = parseCommandArgs("mcp", args, 1, "login").positionals[0];
  const output = input.output;
  const signal = input.signal;

  if (named === undefined && !output.mode.interactive)
    throw new CliError(
      "missing_input",
      "Can't choose an MCP server without an interactive terminal.",
      { next: [{ label: "Name the server", argv: ["nyte", "mcp", "login", "<NAME>"] }] },
    );
  const mcp = await openWorkspace(input.connect);
  const driver = cliLoginDriver(output.mode, signal, () => process.emit("SIGINT"));

  const outcome = await signIn(mcp, named, driver, output).catch((error: unknown) => {
    if (signal.aborted) throw new CliError("canceled", "Canceled.");

    throw error;
  });

  receipt(
    output,
    outcome.kind === "kept"
      ? `Kept the current sign-in for ${outcome.server}`
      : `Signed in to ${outcome.server}`,
    outcome.server,
    [],
  );

  return 0;
}

async function signIn(
  mcp: McpApi,
  named: string | undefined,
  driver: LoginDriver,
  output: Output,
): Promise<{ readonly kind: "kept" | "signed-in"; readonly server: string }> {
  const interactive = output.mode.interactive;
  const view = await settled(mcp, driver.signal);
  const server = named ?? (await chooseServer(view, driver, output));
  const current = view.servers.find((candidate) => candidate.name === server);

  if (current === undefined)
    throw new CliError("not_found", `Couldn't find MCP server ${server}.`, { next: [LIST] });

  if (current.transport.kind === "http" && current.state.kind === "connected" && interactive) {
    const again = await driver.choose(
      `${server} is connected. Sign in again?`,
      [
        { id: "no", label: "No, keep the current sign-in" },
        { id: "yes", label: "Yes, sign in again" },
      ],
      driver.signal,
    );

    if (again === "no") return { kind: "kept", server };
  }

  await runLogin(
    mcp.login(server),
    interactive ? driver : { ...driver, paste: () => new Promise<string>(() => undefined) },
    printable(server),
  );

  return { kind: "signed-in", server };
}

async function chooseServer(view: McpView, driver: LoginDriver, output: Output): Promise<string> {
  const signable = view.servers
    .filter((server) => server.transport.kind === "http" && server.state.kind !== "disabled")
    .toSorted(
      (left, right) =>
        Number(right.state.kind === "needs-sign-in") - Number(left.state.kind === "needs-sign-in"),
    );

  const first = signable[0];

  if (first === undefined)
    throw new CliError("not_found", "Can't find an MCP server that signs in with OAuth.", {
      next: [
        { label: "Add one over HTTP", argv: ["nyte", "mcp", "add", "<NAME>", "--url", "<URL>"] },
      ],
    });

  if (signable.length === 1) {
    output.say(`Signing in to ${printable(first.name)}…`);

    return first.name;
  }

  return driver.choose(
    "Which MCP server?",
    signable.map((server) => ({
      id: server.name,
      label: server.name,
      description: STATES[server.state.kind],
    })),
    driver.signal,
  );
}

async function openWorkspace(connect: Input["connect"], scope?: McpScope): Promise<McpApi> {
  const connection = await connect({ kind: "local" });
  const workspace = connection.workspace(await addFolder(connection, process.cwd()));

  if (scope !== "project") return workspace.mcp;

  if (process.cwd() === homedir())
    throw new CliError(
      "invalid_arguments",
      "Can't use --local in your home folder. Its .nyte/mcp.json is your user file.",
    );

  if ((await workspace.info()).trusted !== true)
    throw new CliError(
      "missing_input",
      "Can't change this folder's .nyte/mcp.json until the folder is trusted.",
      {
        details: [{ label: "Folder", value: process.cwd() }],
        next: [{ label: "Trust this folder, then run this again", argv: ["nyte", "trust"] }],
      },
    );

  return workspace.mcp;
}

async function listedWorkspace(connect: Input["connect"]): Promise<{
  readonly mcp: McpApi;
  readonly folder: "unregistered" | "untrusted" | "trusted";
}> {
  const running = await findRunningHost(hostFilePath());

  if (running === null)
    throw new CliError("host_not_running", "Can't list MCP servers without a running Nyte host.", {
      next: [{ label: "Start the host in another terminal", argv: ["nyte", "host"] }],
    });

  const connection = await connect({
    kind: "attached",
    endpoint: { url: running.url, token: running.token },
  });

  const seen = await connection.workspaces.inspect({ kind: "local", path: process.cwd() });

  if (seen.registered !== null) {
    const workspace = connection.workspace(seen.registered);

    return {
      mcp: workspace.mcp,
      folder: (await workspace.info()).trusted === true ? "trusted" : "untrusted",
    };
  }

  const home = await homeWorkspace(connection);

  if (home === null) throw new CliError("failed", "Couldn't find the Nyte host's home workspace.");

  return { mcp: connection.workspace(home).mcp, folder: "unregistered" };
}

async function homeWorkspace(connection: Connection): Promise<WorkspaceId | null> {
  for await (const view of connection.watch()) return view.defaultWorkspace;

  return null;
}

async function firstView(mcp: McpApi): Promise<McpView> {
  for await (const view of mcp.watch()) return view;

  throw new CliError("failed", "Couldn't read the MCP servers.");
}

function replaceStep(args: readonly string[]): NextStep {
  const split = args.indexOf("--");
  const flags = split < 0 ? args : args.slice(0, split);

  const masked = flags.map((arg, index) => {
    const inline = SECRET_OPTIONS.find((option) => arg.startsWith(`${option.flag}=`));

    if (inline !== undefined) return `${inline.flag}=${inline.placeholder}`;

    return SECRET_OPTIONS.find((option) => flags[index - 1] === option.flag)?.placeholder ?? arg;
  });

  const placeholders = SECRET_OPTIONS.flatMap((option) =>
    masked.some((arg) => arg.endsWith(option.placeholder)) ? [option.placeholder] : [],
  );

  const last = placeholders.at(-1);

  return {
    label:
      last === undefined
        ? "Replace it"
        : `Replace it, filling in ${placeholders.length === 1 ? last : `${placeholders.slice(0, -1).join(", ")} and ${last}`}`,
    argv: ["nyte", "mcp", "add", ...masked, "--force", ...(split < 0 ? [] : args.slice(split))],
  };
}

function settle(outcome: McpChange, verb: string, server: string): void {
  if (outcome.kind === "updated") return;

  if (outcome.kind === "missing")
    throw new CliError("not_found", `Couldn't find MCP server ${server}.`, { next: [LIST] });

  throw new CliError("failed", `Couldn't ${verb} MCP server ${server}.`, {
    details: [{ label: "Reason", value: printable(outcome.message) }],
  });
}

function receipt(output: Output, text: string, server: string, rows: readonly Row[]): void {
  output.status("done", printable(text));
  output.rows(rows);

  if (!output.mode.interactive || !output.mode.tty.stdout)
    output.result(`${output.mode.tty.stdout ? printable(server) : server}\n`);
}

function nextStep(output: Output, step: NextStep): void {
  output.say("");
  output.say(`  ${step.label}:`);
  output.say(formatCommand(step.argv, output.mode.stderr));
}

async function settled(
  mcp: McpApi,
  signal: AbortSignal,
  progress?: (phase: string) => void,
): Promise<McpView> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(LIST_WAIT_MS)]);
  const views = mcp.watch()[Symbol.asyncIterator]();

  const stopped = new Promise<"stopped">((resolve) =>
    deadline.addEventListener("abort", () => resolve("stopped"), { once: true }),
  );

  let latest: McpView | null = null;

  try {
    for (;;) {
      const next = await Promise.race([views.next(), stopped]);

      if (next === "stopped" || next.done === true) break;
      latest = next.value;
      const waiting = latest.servers.filter((server) => server.state.kind === "connecting").length;

      if (waiting === 0) break;
      progress?.(`Connecting to ${String(waiting)} MCP ${waiting === 1 ? "server" : "servers"}…`);
    }
  } finally {
    await views.return?.();
  }

  signal.throwIfAborted();

  if (latest === null) throw new CliError("failed", "Couldn't read the MCP servers.");

  return latest;
}

function listDocument(view: McpView): Json {
  return {
    servers: view.servers.map((server) => ({ ...server, exposure: exposureName(server.exposure) })),
    issues: view.issues.map((issue) => ({
      severity: issue.severity,
      path: issue.path,
      message: issue.message,
      source:
        issue.source === undefined
          ? null
          : {
              plugin: issue.source.plugin,
              file: issue.source.file ?? null,
              line: issue.source.line ?? null,
            },
    })),
  };
}

function showList(view: McpView, output: Output): void {
  if (view.servers.length === 0 && view.issues.length === 0) {
    output.say("No MCP servers.");
    nextStep(output, {
      label: "Add one",
      argv: ["nyte", "mcp", "add", "<NAME>", "--url", "<URL>"],
    });

    return;
  }

  if (view.servers.length > 0)
    output.result(
      `${formatTable(["Name", "Scope", "State", "Tools", "Target"], view.servers.map(tableRow), output.mode.stdout).join("\n")}\n`,
    );

  const failing = view.servers.filter(
    (server) => server.state.kind === "failed" || server.state.kind === "needs-sign-in",
  );

  if (failing.length === 0 && view.issues.length === 0) return;
  output.say("");

  for (const server of failing) warnServer(server, output);

  for (const issue of view.issues)
    output.status(
      "warn",
      `${printable(issue.source?.file ?? "mcp.json")}: ${printable(issue.message)}`,
    );

  if (failing.some((server) => server.state.kind === "needs-sign-in"))
    nextStep(output, { label: "Sign in to a server", argv: ["nyte", "mcp", "login"] });
}

function tableRow(server: McpServerView): readonly string[] {
  return [
    printable(server.name),
    server.scope,
    STATES[server.state.kind],
    server.state.kind === "connected" ? String(server.state.tools.length) : "",
    printable(target(server)),
  ];
}

function warnServer(server: McpServerView, output: Output): void {
  if (server.state.kind !== "failed") {
    output.status("warn", `${printable(server.name)} needs sign-in.`);

    return;
  }

  output.status("warn", printable(server.state.message));
  const lines = (server.state.stderr ?? "").split(/\r?\n/u).filter((line) => line.trim() !== "");

  for (const line of lines.slice(0, STDERR_LINES)) output.say(`  ${printable(line)}`);
  const more = lines.length - STDERR_LINES;

  if (more > 0)
    output.say(
      `  and ${String(more)} more ${more === 1 ? "line" : "lines"} in nyte mcp list --json`,
    );
}

function serverName(
  action: "remove" | "logout",
  positionals: readonly string[],
  missing: string,
): string {
  const server = positionals[0];

  if (server === undefined)
    throw new CliError("missing_input", missing, {
      next: [{ label: "Name the server", argv: ["nyte", "mcp", action, "<NAME>"] }],
    });

  return server;
}

function pair(text: string, flag: string): readonly [string, string] {
  const split = text.indexOf("=");

  if (split <= 0)
    throw new CliError("invalid_arguments", `${flag} takes KEY=VALUE, not ${text}.`, {
      next: ADD_HELP,
    });

  return [text.slice(0, split), text.slice(split + 1)];
}

function usage(message: string): never {
  throw new CliError("invalid_arguments", message, { next: ADD_HELP });
}

function parseAdd(args: readonly string[]) {
  const split = args.indexOf("--");
  const command = split < 0 ? [] : args.slice(split + 1);
  const parsed = parseCommandArgs("mcp", split < 0 ? args : args.slice(0, split), 1, "add");
  const server = parsed.positionals[0];

  if (server === undefined)
    throw new CliError("missing_input", "Can't add an MCP server without a name.", {
      next: [{ label: "Name it", argv: ["nyte", "mcp", "add", "<NAME>", "--url", "<URL>"] }],
    });

  const named = parsed.value("exposure");
  const exposure = EXPOSURES.find((candidate) => candidate === named);

  if (named !== undefined && exposure === undefined)
    usage(
      `--exposure takes direct, deferred, codemode, codemode-deferred or hidden, not ${named}.`,
    );
  const env = Object.fromEntries(parsed.values("env").map((text) => pair(text, "--env")));
  const headers = Object.fromEntries(parsed.values("header").map((text) => pair(text, "--header")));
  const bearer = parsed.value("bearer-token-env-var");

  if (bearer !== undefined) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(bearer))
      usage(`--bearer-token-env-var takes a variable name, not ${bearer}.`);
    headers["Authorization"] = `Bearer \${${bearer}}`;
  }

  const portText = parsed.value("oauth-callback-port");
  const port = portText === undefined ? undefined : Number(portText);

  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535))
    usage(`--oauth-callback-port takes a port from 1 to 65535, not ${portText ?? ""}.`);

  const clientId = parsed.value("oauth-client-id");
  const clientSecret = parsed.value("oauth-client-secret");
  const clientName = parsed.value("oauth-client-name");

  const oauth = {
    ...(clientId === undefined ? {} : { clientId }),
    ...(clientSecret === undefined ? {} : { clientSecret }),
    ...(clientName === undefined ? {} : { clientName }),
    ...(port === undefined ? {} : { callbackPort: port }),
  };

  const scope: McpScope = parsed.has("local") ? "project" : "user";
  const force = parsed.has("force");
  const description = parsed.value("description");
  const url = parsed.value("url");
  const cwd = parsed.value("cwd");

  const common = {
    ...(description === undefined ? {} : { description }),
    ...(exposure === undefined ? {} : { exposure }),
  };

  if (url !== undefined) {
    if (command.length > 0) usage("Can't use --url and a command after -- together.");

    if (Object.keys(env).length > 0 || cwd !== undefined)
      usage("--env and --cwd apply to a command, not a --url server.");

    return {
      server,
      scope,
      force,
      config: {
        ...common,
        url,
        ...(Object.keys(headers).length === 0 ? {} : { headers }),
        ...(Object.keys(oauth).length === 0 ? {} : { oauth }),
      } satisfies McpServerConfig,
    };
  }

  const executable = command[0];

  if (executable === undefined)
    throw new CliError(
      "missing_input",
      `Can't add ${server} without --url or a command after --.`,
      {
        next: [
          { label: "Add it over HTTP", argv: ["nyte", "mcp", "add", server, "--url", "<URL>"] },
          { label: "Add it over stdio", argv: ["nyte", "mcp", "add", server, "--", "<COMMAND>"] },
        ],
      },
    );

  if (Object.keys(headers).length > 0 || Object.keys(oauth).length > 0)
    usage("--header, --bearer-token-env-var and --oauth-* apply to a --url server, not a command.");
  const rest = command.slice(1);

  return {
    server,
    scope,
    force,
    config: {
      ...common,
      command: executable,
      ...(rest.length === 0 ? {} : { args: rest }),
      ...(Object.keys(env).length === 0 ? {} : { env }),
      ...(cwd === undefined ? {} : { cwd }),
    } satisfies McpServerConfig,
  };
}
