import process from "node:process";
import type {
  Connection,
  McpApi,
  McpChange,
  McpExposureName,
  McpScope,
  McpServerConfig,
  McpServerView,
  McpView,
} from "@nyte-ai/sdk";
import { alignedRows, ansiEnabled } from "./cli-style.ts";
import { cliLoginDriver } from "./interaction.ts";
import { exposureName, target } from "./model/mcp.ts";
import { addFolder } from "./run.ts";
import { runLogin } from "./services/auth.ts";

interface Output {
  readonly write: (text: string) => void;
  readonly error: (text: string) => void;
}

const USAGE = "Usage: nyte mcp <add | remove | list | login | logout>. Run `nyte mcp --help`.";

const EXPOSURES = ["direct", "deferred", "codemode", "codemode-deferred", "hidden"] as const;

const LIST_WAIT_MS = 15_000;

/**
 * `nyte mcp`: changes `mcp.json` and signs in to servers from a shell,
 * through the local service, for the folder it runs in. Returns the exit
 * code: `list` answers 1 when an entry is invalid or an enabled server is
 * not connected.
 */
export async function mcpCommand(input: {
  readonly args: readonly string[];
  readonly connection: () => Promise<Connection>;
  readonly signal: AbortSignal;
  readonly output: Output;
}): Promise<number> {
  const { args, output } = input;
  const [command, ...rest] = args;

  const workspace = async () => {
    const connection = await input.connection();

    return connection.workspace(await addFolder(connection, process.cwd())).mcp;
  };

  switch (command) {
    case "add": {
      const { server, config, scope } = parseAdd(rest);

      return report(await (await workspace()).add(server, config, scope), server, output, {
        updated: `Added ${server} to ${scope === "user" ? "~/.nyte/mcp.json" : ".nyte/mcp.json"}. Run \`nyte mcp list\` to check it.`,
      });
    }

    case "remove": {
      const { server, scope } = parseNamed("remove", rest, true);

      return report(await (await workspace()).remove(server, scope), server, output, {
        updated: `Removed ${server} from ${scope === "user" ? "~/.nyte/mcp.json" : ".nyte/mcp.json"}.`,
      });
    }

    case "logout": {
      const { server } = parseNamed("logout", rest, false);

      return report(await (await workspace()).logout(server), server, output, {
        updated: `Signed out of ${server}.`,
      });
    }

    case "login":
      return login(rest, await workspace(), input.signal, output);

    case "list": {
      const json = rest.includes("--json");

      if (rest.some((arg) => arg !== "--json")) throw new Error("Usage: nyte mcp list [--json]");
      const view = await settled(await workspace(), input.signal);

      if (json) output.write(`${JSON.stringify(view)}\n`);
      else output.write(`${listLines(view).join("\n")}\n`);

      const failing =
        view.issues.length > 0 ||
        view.servers.some(
          (server) => server.state.kind !== "connected" && server.state.kind !== "disabled",
        );

      return failing ? 1 : 0;
    }

    default:
      throw new Error(USAGE);
  }
}

async function login(
  args: readonly string[],
  mcp: McpApi,
  signal: AbortSignal,
  output: Output,
): Promise<number> {
  const [named, ...extra] = args;

  if (extra.length > 0 || (named !== undefined && named.startsWith("-")))
    throw new Error("Usage: nyte mcp login [<name>]. Run `nyte mcp --help`.");
  const interactive = Boolean(process.stdin.isTTY && process.stderr.isTTY);

  if (named === undefined && !interactive)
    throw new Error("Without an interactive terminal, name the server: `nyte mcp login <name>`.");

  const driver = cliLoginDriver(signal, () => process.emit("SIGINT"));
  const view = await settled(mcp, signal);

  const signable = view.servers
    .filter((server) => server.transport.kind === "http" && server.state.kind !== "disabled")
    .toSorted(
      (left, right) =>
        Number(right.state.kind === "needs-sign-in") - Number(left.state.kind === "needs-sign-in"),
    );

  if (named === undefined && signable.length === 0) {
    output.error(
      "No MCP server signs in with OAuth. Add one with `nyte mcp add <name> --url <url>`.",
    );

    return 1;
  }

  const server =
    named ??
    (await driver.choose(
      "Sign in to which MCP server?",
      signable.map((candidate) => ({
        id: candidate.name,
        label:
          candidate.state.kind === "needs-sign-in"
            ? `${candidate.name} (needs sign-in)`
            : candidate.name,
      })),
      signal,
    ));

  const current = view.servers.find((candidate) => candidate.name === server);

  if (current?.transport.kind === "http" && current.state.kind === "connected" && interactive) {
    const again = await driver.choose(
      `${server} is connected. Sign in again?`,
      [
        { id: "no", label: "No, keep the current sign-in" },
        { id: "yes", label: "Yes, sign in again" },
      ],
      signal,
    );

    if (again === "no") {
      output.write(`Kept the current sign-in for ${server}.\n`);

      return 0;
    }
  }

  await runLogin(
    mcp.login(server),
    interactive ? driver : { ...driver, paste: () => new Promise<string>(() => undefined) },
    server,
  );
  output.write(`Signed in to ${server}.\n`);

  return 0;
}

function report(
  outcome: McpChange,
  server: string,
  output: Output,
  copy: { readonly updated: string },
): number {
  switch (outcome.kind) {
    case "updated":
      output.write(`${copy.updated}\n`);

      return 0;
    case "missing":
      output.error(`No MCP server is named ${server}. Run \`nyte mcp list\` to see them.`);

      return 1;
    case "invalid":
      output.error(outcome.message);

      return 1;
    default: {
      const _exhaustive: never = outcome;

      return _exhaustive;
    }
  }
}

async function settled(mcp: McpApi, signal: AbortSignal): Promise<McpView> {
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

      if (latest.servers.every((server) => server.state.kind !== "connecting")) break;
    }
  } finally {
    await views.return?.();
  }

  signal.throwIfAborted();

  if (latest === null) throw new Error("The MCP servers could not be read.");

  return latest;
}

function listLines(view: McpView): readonly string[] {
  if (view.servers.length === 0 && view.issues.length === 0)
    return ["No MCP servers. Add one with `nyte mcp add <name> --url <url>`."];

  const color = ansiEnabled();

  const rows = view.servers.map((server) => ({
    label: server.name,
    detail: `${stateText(server)} · ${target(server)}`,
  }));

  return [
    ...alignedRows(rows, color),
    ...view.servers.flatMap((server) =>
      server.state.kind === "failed"
        ? [
            "",
            server.state.message,
            ...(server.state.stderr === null ? [] : [server.state.stderr]),
          ]
        : server.state.kind === "needs-sign-in"
          ? ["", `${server.name}: run \`nyte mcp login ${server.name}\` to sign in.`]
          : [],
    ),
    ...view.issues.map((issue) => `${issue.source?.file ?? "mcp.json"}: ${issue.message}`),
  ];
}

function stateText(server: McpServerView): string {
  const { state } = server;

  if (state.kind === "connected")
    return `${String(state.tools.length)} ${state.tools.length === 1 ? "tool" : "tools"}, ${exposureName(server.exposure)}`;

  return state.kind === "disabled" ? "off" : state.kind;
}

function parseNamed(
  command: "remove" | "logout",
  args: readonly string[],
  scoped: boolean,
): { readonly server: string; readonly scope: McpScope } {
  const local = scoped && args.some((arg) => arg === "--local" || arg === "-l");
  const names = args.filter((arg) => !(scoped && (arg === "--local" || arg === "-l")));
  const [server, ...extra] = names;

  if (server === undefined || server.startsWith("-") || extra.length > 0)
    throw new Error(
      `Usage: nyte mcp ${command} <name>${scoped ? " [--local]" : ""}. Run \`nyte mcp --help\`.`,
    );

  return { server, scope: local ? "project" : "user" };
}

function pair(text: string, flag: string): readonly [string, string] {
  const at = text.indexOf("=");

  if (at <= 0) throw new Error(`${flag} takes KEY=VALUE, not ${text}.`);

  return [text.slice(0, at), text.slice(at + 1)];
}

function parseAdd(args: readonly string[]): {
  readonly server: string;
  readonly config: McpServerConfig;
  readonly scope: McpScope;
} {
  const split = args.indexOf("--");
  const flags = split < 0 ? args : args.slice(0, split);
  const command = split < 0 ? [] : args.slice(split + 1);
  let positional: string | undefined;

  let scope: McpScope = "user";
  let url: string | undefined;
  let cwd: string | undefined;
  let description: string | undefined;
  let exposure: McpExposureName | undefined;
  const env: Record<string, string> = {};
  const headers: Record<string, string> = {};
  const oauth: Record<string, string> = {};
  let callbackPort: number | undefined;

  const value = (index: number, flag: string): string => {
    const found = flags[index + 1];

    if (found === undefined || found.startsWith("--")) throw new Error(`${flag} needs a value.`);

    return found;
  };

  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];

    switch (flag) {
      case "--local":
      case "-l":
        scope = "project";
        continue;
      case "--url":
        url = value(index, flag);
        break;
      case "--cwd":
        cwd = value(index, flag);
        break;
      case "--description":
        description = value(index, flag);
        break;
      case "--exposure": {
        const named = value(index, flag);
        const found = EXPOSURES.find((candidate) => candidate === named);

        if (found === undefined)
          throw new Error(`--exposure must be one of ${EXPOSURES.join(", ")}.`);
        exposure = found;
        break;
      }

      case "--env": {
        const [key, text] = pair(value(index, flag), flag);
        env[key] = text;
        break;
      }

      case "--header": {
        const [key, text] = pair(value(index, flag), flag);
        headers[key] = text;
        break;
      }

      case "--bearer-token-env-var": {
        const name = value(index, flag);

        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
          throw new Error(`${flag} takes an environment variable name, not ${name}.`);
        headers.Authorization = `Bearer \${${name}}`;
        break;
      }

      case "--oauth-client-id":
        oauth.clientId = value(index, flag);
        break;
      case "--oauth-client-secret":
        oauth.clientSecret = value(index, flag);
        break;
      case "--oauth-client-name":
        oauth.clientName = value(index, flag);
        break;
      case "--oauth-callback-port": {
        const port = Number(value(index, flag));

        if (!Number.isInteger(port) || port < 1 || port > 65535)
          throw new Error(`${flag} takes a port from 1 to 65535.`);
        callbackPort = port;
        break;
      }

      default:
        if (flag.startsWith("-"))
          throw new Error(`Unknown option ${flag}. Run \`nyte mcp --help\`.`);

        if (positional !== undefined)
          throw new Error(
            `Unexpected ${flag}: put a server's command after --. Run \`nyte mcp --help\`.`,
          );
        positional = flag;
        continue;
    }

    index += 1;
  }

  if (positional === undefined)
    throw new Error("Usage: nyte mcp add <name> [options] (--url <url> | -- <command> [args...])");
  const server = positional;

  const common = {
    ...(description === undefined ? {} : { description }),
    ...(exposure === undefined ? {} : { exposure }),
  };

  if (url !== undefined) {
    if (command.length > 0) throw new Error("Give --url or a command after --, not both.");

    if (Object.keys(env).length > 0 || cwd !== undefined)
      throw new Error("--env and --cwd apply to a command, not a --url server.");

    const auth = {
      ...oauth,
      ...(callbackPort === undefined ? {} : { callbackPort }),
    };

    return {
      server,
      scope,
      config: {
        ...common,
        url,
        ...(Object.keys(headers).length === 0 ? {} : { headers }),
        ...(Object.keys(auth).length === 0 ? {} : { oauth: auth }),
      },
    };
  }

  const [executable, ...rest] = command;

  if (executable === undefined)
    throw new Error("Give --url <url> or a command after --. Run `nyte mcp --help`.");

  if (
    Object.keys(headers).length > 0 ||
    Object.keys(oauth).length > 0 ||
    callbackPort !== undefined
  )
    throw new Error("--header and --oauth-* apply to a --url server, not a command.");

  return {
    server,
    scope,
    config: {
      ...common,
      command: executable,
      ...(rest.length === 0 ? {} : { args: rest }),
      ...(Object.keys(env).length === 0 ? {} : { env }),
      ...(cwd === undefined ? {} : { cwd }),
    },
  };
}
