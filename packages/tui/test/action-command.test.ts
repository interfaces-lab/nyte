import { expect, test } from "bun:test";
import type { HostSocket } from "@nyte-ai/protocol";
import { asId, isJsonObject } from "@nyte-ai/schema";
import type { ClientRow, Json } from "@nyte-ai/schema";
import { actionCommand } from "../src/action-command.ts";
import { CliError } from "../src/cli/errors.ts";
import type { Reason } from "../src/cli/errors.ts";
import { formatRows, formatStatus } from "../src/cli/format.ts";
import { resolveMode } from "../src/cli/mode.ts";
import type { Output } from "../src/cli/output.ts";

const NEW_CHAT = { name: "chat.new", summary: "Starts a new chat.", input: {} };

const THEME = { name: "setting.theme", summary: "Reads or sets the theme.", input: {} };

function client(id: string, actions: ClientRow["actions"]): ClientRow {
  return {
    id: asId<"client">(id),
    principal: asId<"principal">("local"),
    kind: "app",
    name: "Nyte",
    version: "1",
    actions,
    since: 1,
  };
}

const WINDOW = client("window-1", [NEW_CHAT, THEME]);

const SECOND = client("window-2", [NEW_CHAT, THEME]);

const TERMINAL = client("terminal-1", []);

interface Case {
  readonly name: string;
  readonly clients: readonly ClientRow[];
  readonly args: readonly string[];
  readonly asked: readonly Json[];
  readonly outcome: number | Reason;
  readonly stdout?: string;
}

const CASES: readonly Case[] = [
  {
    name: "one client offers the action, so it is asked",
    clients: [WINDOW, TERMINAL],
    args: ["run", "chat.new"],
    asked: [{ client: "window-1", action: "chat.new", input: {} }],
    outcome: 0,
    stdout: "",
  },
  {
    name: "no client offers the action",
    clients: [TERMINAL],
    args: ["run", "chat.new"],
    asked: [],
    outcome: "not_found",
  },
  {
    name: "several offer it and none is named, so nothing is asked",
    clients: [WINDOW, SECOND],
    args: ["run", "chat.new"],
    asked: [],
    outcome: "missing_input",
  },
  {
    name: "--client names one of several",
    clients: [WINDOW, SECOND],
    args: ["run", "chat.new", "--client", "window-2"],
    asked: [{ client: "window-2", action: "chat.new", input: {} }],
    outcome: 0,
  },
  {
    name: "--client names a client that is not connected",
    clients: [WINDOW],
    args: ["run", "chat.new", "--client", "window-9"],
    asked: [],
    outcome: "not_found",
  },
  {
    name: "--client names a client that does not offer the action",
    clients: [WINDOW, TERMINAL],
    args: ["run", "chat.new", "--client", "terminal-1"],
    asked: [],
    outcome: "not_found",
  },
  {
    name: "each KEY=VALUE is one field, read as JSON and else as text",
    clients: [WINDOW],
    args: ["run", "setting.theme", "value=dark", "size=13", "on=true", "list=[1]", "url=a=b"],
    asked: [
      {
        client: "window-1",
        action: "setting.theme",
        input: { value: "dark", size: 13, on: true, list: [1], url: "a=b" },
      },
    ],
    outcome: 0,
    stdout: '{"answered":"setting.theme"}\n',
  },
  {
    name: "a field without = is refused before anything is asked",
    clients: [WINDOW],
    args: ["run", "setting.theme", "dark"],
    asked: [],
    outcome: "invalid_arguments",
  },
  {
    name: "run without an action",
    clients: [WINDOW],
    args: ["run"],
    asked: [],
    outcome: "missing_input",
  },
  {
    name: "list prints one row per action a client offers",
    clients: [WINDOW, TERMINAL],
    args: ["list"],
    asked: [],
    outcome: 0,
    stdout:
      "Client\tName\tAction\tSummary\nwindow-1\tNyte\tchat.new\tStarts a new chat.\nwindow-1\tNyte\tsetting.theme\tReads or sets the theme.\n",
  },
  {
    name: "list with no offers prints nothing on stdout",
    clients: [TERMINAL],
    args: ["list"],
    asked: [],
    outcome: 0,
    stdout: "",
  },
];

test.each(CASES)("nyte action: $name", async (entry) => {
  const asked: Json[] = [];
  const streams = { stdout: "", stderr: "" };
  const mode = resolveMode({ env: {}, stdin: {}, stdout: {}, stderr: {} }, false);

  const output: Output = {
    mode,
    closed: new AbortController().signal,
    result: (text) => void (streams.stdout += text),
    json: (value) => void (streams.stdout += `${JSON.stringify(value)}\n`),
    say: (text) => void (streams.stderr += `${text}\n`),
    rows: (rows) => void (streams.stderr += `${formatRows(rows, mode.stderr).join("\n")}\n`),
    status: (gutter, text) =>
      void (streams.stderr += `${formatStatus(gutter, text, mode.stderr)}\n`),
    progress: (phase) => void (streams.stderr += `${phase}\n`),
  };

  const socket: HostSocket = {
    welcome: Promise.withResolvers<never>().promise,
    closed: Promise.withResolvers<never>().promise,
    async call(op, input) {
      if (op === "clients.read") return [...entry.clients];
      asked.push(input);

      return isJsonObject(input) && input.action !== "chat.new"
        ? { answered: input.action ?? null }
        : null;
    },
    onEvent: () => () => undefined,
    onText: () => () => undefined,
    probe: async () => undefined,
    close: () => undefined,
  };

  const outcome = await actionCommand({
    args: entry.args,
    connect: async () => socket,
    output,
    width: 80,
  }).catch((error: unknown) => {
    if (!(error instanceof CliError)) throw error;

    return error.reason;
  });

  expect(outcome).toBe(entry.outcome);
  expect(JSON.stringify(asked)).toBe(JSON.stringify(entry.asked));

  if (entry.stdout !== undefined) expect(streams.stdout).toBe(entry.stdout);
});
