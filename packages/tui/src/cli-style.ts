import process from "node:process";
import { GLYPHS, THINKING_LEVELS } from "./lib/constants.ts";
import type { UpdateOutcome } from "./update.ts";
import { VERSION } from "./version.ts";

export function ansiEnabled(stream: Pick<NodeJS.WriteStream, "isTTY"> = process.stdout): boolean {
  if (!stream.isTTY) return false;
  const noColor = process.env["NO_COLOR"];

  if (noColor !== undefined && noColor !== "") return false;

  return process.env["CI"] !== "true";
}

const SGR = { bold: "1", dim: "2", red: "31", green: "32", yellow: "33", cyan: "36" } as const;

type SgrCode = (typeof SGR)[keyof typeof SGR];

function paint(enabled: boolean, code: SgrCode, text: string): string {
  return enabled ? `\x1b[${code}m${text}\x1b[0m` : text;
}

export function bold(text: string, color: boolean = ansiEnabled()): string {
  return paint(color, SGR.bold, text);
}

export function dim(text: string, color: boolean = ansiEnabled()): string {
  return paint(color, SGR.dim, text);
}

export function cyan(text: string, color: boolean = ansiEnabled()): string {
  return paint(color, SGR.cyan, text);
}

type Severity = "ok" | "warn" | "fail";

interface SeverityStyle {
  readonly glyph: string;
  readonly code: SgrCode;
}

const SEVERITY_STYLE: Readonly<Record<Severity, SeverityStyle>> = {
  ok: { glyph: GLYPHS.check, code: SGR.green },
  warn: { glyph: GLYPHS.bullet, code: SGR.yellow },
  fail: { glyph: GLYPHS.cross, code: SGR.red },
};

export function statusGlyph(severity: Severity, color: boolean): string {
  const { glyph, code } = SEVERITY_STYLE[severity];

  return paint(color, code, glyph);
}

export function updateSeverity(outcome: UpdateOutcome): Severity {
  switch (outcome.kind) {
    case "updated":
    case "current":
      return "ok";
    case "unsupported":
      return "warn";
    case "failed":
      return "fail";
    default: {
      const _exhaustive: never = outcome;

      return _exhaustive;
    }
  }
}

interface AlignedRow {
  readonly label: string;
  readonly detail: string;
}

const COLUMN_GAP = 2;

export function alignedRows(
  rows: readonly AlignedRow[],
  color: boolean,
  width = rows.reduce((max, row) => Math.max(max, row.label.length), 0),
): string[] {
  return rows.map(({ label, detail }) => {
    const styled = paint(color, SGR.bold, label);

    if (detail === "") return `  ${styled}`;
    const pad = " ".repeat(Math.max(0, width - label.length) + COLUMN_GAP);

    return `  ${styled}${pad}${paint(color, SGR.dim, detail)}`;
  });
}

const HELP_LABEL_WIDTH = 29;

const HELP_COMMANDS: readonly AlignedRow[] = [
  { label: "nyte", detail: "open the full-screen TUI" },
  { label: "nyte --minimal", detail: "open compact interactive terminal mode" },
  { label: "nyte --resume [<session-id>]", detail: "resume the latest or specified session" },
  { label: "nyte login [<provider>]", detail: "sign in; choose a provider when omitted" },
  { label: "nyte logout [<provider>]", detail: "remove stored credentials; choose when omitted" },
  { label: "nyte status", detail: "list stored credentials" },
  {
    label: "nyte update [version|--check|--models]",
    detail: "install nyte, check for an update, or refresh models",
  },
  { label: "nyte account [status|unlink]", detail: "share this machine with your Nyte account" },
  { label: "nyte mcp <add|remove|list|login|logout>", detail: "manage MCP servers" },
  { label: "nyte host [--json]", detail: "serve your chats for --host-url to attach to" },
  { label: "nyte --version", detail: "print the installed version" },
  { label: "nyte -p [--json] [--quiet] [--resume] [prompt]", detail: "" },
];

const HELP_FLAGS: readonly AlignedRow[] = [
  { label: "--minimal", detail: "experimental; requires terminal stdin and stdout" },
  { label: "--provider <id>", detail: "override the saved provider" },
  { label: "--model <id>", detail: "override the saved model" },
  { label: "--session <session-id>", detail: "target a session; mutually exclusive with --resume" },
  { label: "--effort <level>", detail: `set thinking level: ${THINKING_LEVELS.join(", ")}` },
  { label: "--trust, --no-trust", detail: "save whether this folder's project files load" },
  {
    label: "--no-context-files",
    detail: "start new sessions without AGENTS.md or CLAUDE.md files",
  },
  { label: "--host-url <url>", detail: "attach to a running nyte host; token in NYTE_HOST_TOKEN" },
];

export function renderHelp(color: boolean = ansiEnabled()): string {
  return [
    `${paint(color, SGR.bold, "nyte")} ${paint(color, SGR.dim, `v${VERSION} · durable agent sessions in your terminal`)}`,
    "",
    `  ${paint(color, SGR.dim, "usage:")}`,
    `  ${paint(color, SGR.bold, "nyte")} ${paint(color, SGR.dim, "[command] [flags]")}`,
    "",
    `  ${paint(color, SGR.dim, "commands:")}`,
    ...alignedRows(HELP_COMMANDS, color, HELP_LABEL_WIDTH),
    "",
    `  ${paint(color, SGR.dim, "flags:")}`,
    ...alignedRows(HELP_FLAGS, color, HELP_LABEL_WIDTH),
    "",
    `  ${paint(color, SGR.dim, "login accepts --method oauth|api_key; otherwise choose an available method")}`,
    `  ${paint(color, SGR.dim, "login requires terminal stdin and stderr; logout requires an explicit provider without them")}`,
    `  ${paint(color, SGR.dim, "authentication prompts require an interactive terminal")}`,
    `  ${paint(color, SGR.dim, "a missing -p prompt is read from stdin")}`,
    `  ${paint(color, SGR.dim, "piped stdin selects print mode, including with terminal stdout")}`,
    `  ${paint(color, SGR.dim, "-p --resume treats positional text as a prompt for the latest session")}`,
    `  ${paint(color, SGR.dim, "use -p --session <session-id> <prompt> to send to a specific session")}`,
    `  ${paint(color, SGR.dim, "use nyte --session <session-id> in a terminal to inspect without resending")}`,
  ].join("\n");
}

export function renderCommandHelp(
  command: "login" | "logout" | "update" | "status" | "account" | "mcp" | "host",
): string {
  switch (command) {
    case "login":
      return [
        "Usage: nyte login [<provider>] [--method oauth|api_key]",
        "Sign in; choose a provider when omitted and choose an available method when needed.",
        "Requires an interactive terminal on stdin and stderr, even with an explicit provider and method.",
        "Prompts and auth instructions use stderr; the saved-login receipt uses stdout.",
        "Example: nyte login openai --method api_key",
      ].join("\n");
    case "logout":
      return [
        "Usage: nyte logout [<provider>]",
        "Remove the selected stored credential; choose a provider when omitted.",
        "Without terminal stdin and stderr, provide a provider argument.",
        "External environment or tool credentials remain active; the stdout receipt reports them.",
        "Example: nyte logout openai",
      ].join("\n");
    case "update":
      return [
        "Usage: nyte update [<version> | --check | --models]",
        "Install the latest release or an explicit version; --check only checks for an update.",
        "--models refreshes the model catalog without updating nyte.",
        "A version, --check, and --models are mutually exclusive. Progress uses stderr; results use stdout.",
        "Examples: nyte update | nyte update 0.0.2 | nyte update --check | nyte update --models",
      ].join("\n");
    case "status":
      return [
        "Usage: nyte status [--json]",
        "List stored credential providers and methods without exposing values.",
        "--json emits a status record then a terminal result as JSONL on stdout.",
        "Example: nyte status --json",
      ].join("\n");
    case "account":
      return [
        "Usage: nyte account [status | unlink]",
        "Link this machine to your Nyte account; every nyte and Nyte.app then shares it while one runs.",
        "Separate from `nyte login`, which signs in a model provider.",
        "Not linked yet: opens the approval page in your browser and prints the code to enter there.",
        "status prints the link and its devices; unlink removes this machine from the account.",
        "Example: nyte account",
      ].join("\n");
    case "host":
      return [
        "Usage: nyte host [--json]",
        "Serve your chats on 127.0.0.1 until stopped, so other nyte processes attach with --host-url.",
        "Writes the URL, token and pid to ~/.nyte/host.json (mode 0600) and removes it on exit.",
        "One host runs at a time; a second exits 1 and names the first.",
        'Prints the URL on stdout; --json prints one {"type":"listening","url","endpoint","pid"} line.',
        "SIGINT, SIGTERM and SIGHUP stop it and exit 0.",
        "Attach: NYTE_HOST_TOKEN=<token from host.json> nyte --host-url <url>",
      ].join("\n");
    case "mcp":
      return [
        "Usage: nyte mcp <command>",
        "  add <name> [options] --url <url>         add a streamable HTTP server",
        "  add <name> [options] -- <command> [args]  add a server run over stdio",
        "  remove <name> [--local]                  remove a server; its sign-in stays",
        "  list [--json]                            connect every server and print its state",
        "  login [<name>]                           sign in to a server with OAuth; choose when omitted",
        "  logout <name>                            delete a server's stored sign-in",
        "",
        "add and remove change ~/.nyte/mcp.json, or this folder's .nyte/mcp.json with --local (-l),",
        "which needs the folder to be trusted. add options: --env KEY=VALUE, --cwd <dir>,",
        "--header KEY=VALUE, --bearer-token-env-var <NAME>, --oauth-client-id <id>,",
        "--oauth-client-secret <secret>, --oauth-callback-port <n>, --oauth-client-name <name>,",
        "--exposure direct|deferred|codemode|codemode-deferred|hidden, --description <text>.",
        "${VAR} in env, headers and secrets comes from the environment Nyte runs in, so export it",
        "before nyte starts. --bearer-token-env-var keeps a token out of the file.",
        "list exits 1 when an entry is invalid or an enabled server is not connected.",
        "login without a name needs an interactive terminal; over SSH, paste the URL the browser ends on.",
        "Examples: nyte mcp add docs --url https://example.com/mcp",
        "          nyte mcp add files -- npx -y @modelcontextprotocol/server-filesystem .",
      ].join("\n");
    default: {
      const _exhaustive: never = command;

      return _exhaustive;
    }
  }
}
