/**
 * Styling for the command surface outside the TUI: help, login, logout,
 * status, update, errors. Builders take an explicit `color` flag so tests
 * assert plain strings; the thin wrappers read the terminal lazily. Piped or
 * redirected output stays unstyled, so scripts keep parsing bare text.
 */
import process from "node:process";
import { MODEL_THINKING_LEVELS } from "@nyte-ai/schema";
import { GLYPHS } from "./constants.ts";
import type { UpdateOutcome } from "./update.ts";
import { VERSION } from "./version.ts";

/** True only for an interactive terminal that has not opted out of color. */
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

/** How a finished step reads. One vocabulary for glyphs, colors, and exit codes. */
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

/** The gutter glyph for a finished step: ✓ done, ● needs attention, ✗ failed. */
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

/** `label  detail` rows sharing one detail column. A row with no detail is just its label. */
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

/** Widest command label in the help screen, so both sections share a column. */
const HELP_LABEL_WIDTH = 29;

const HELP_COMMANDS: readonly AlignedRow[] = [
  { label: "nyte", detail: "open the full-screen TUI" },
  { label: "nyte --resume [<session-id>]", detail: "resume the latest or specified session" },
  { label: "nyte login [<provider>]", detail: "sign in; choose a provider when omitted" },
  { label: "nyte logout [<provider>]", detail: "remove stored credentials; choose when omitted" },
  { label: "nyte status", detail: "list stored credentials" },
  {
    label: "nyte update [version|--check]",
    detail: "install the latest release, a given one, or only check",
  },
  { label: "nyte --version", detail: "print the installed version" },
  { label: "nyte -p [--json] [--quiet] [--resume] [prompt]", detail: "" },
];

const HELP_FLAGS: readonly AlignedRow[] = [
  { label: "--provider <id>", detail: "override the saved provider" },
  { label: "--model <id>", detail: "override the saved model" },
  { label: "--session <session-id>", detail: "target a session; mutually exclusive with --resume" },
  { label: "--effort <level>", detail: `set thinking level: ${MODEL_THINKING_LEVELS.join(", ")}` },
];

/** The `--help` screen. Colored on a TTY, plain otherwise. */
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

export function renderCommandHelp(command: "login" | "logout" | "update" | "status"): string {
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
        "Usage: nyte update [<version> | --check]",
        "Install the latest release or an explicit version; --check only checks for an update.",
        "A version and --check are mutually exclusive. Progress uses stderr; the result uses stdout.",
        "Examples: nyte update | nyte update 0.0.2 | nyte update --check",
      ].join("\n");
    case "status":
      return [
        "Usage: nyte status [--json]",
        "List stored credential providers and methods without exposing values.",
        "--json emits a status record then a terminal result as JSONL on stdout.",
        "Example: nyte status --json",
      ].join("\n");
    default: {
      const _exhaustive: never = command;
      return _exhaustive;
    }
  }
}
