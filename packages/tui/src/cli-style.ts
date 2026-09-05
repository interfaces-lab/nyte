/**
 * Styling for the command surface outside the TUI: help, login, logout,
 * status, update, errors. Builders take an explicit `color` flag so tests
 * assert plain strings; the thin wrappers read the terminal lazily. Piped or
 * redirected output stays unstyled, so scripts keep parsing bare text.
 */
import process from "node:process";
import { GLYPHS } from "./constants.ts";
import type { UpdateOutcome } from "./update.ts";
import { VERSION } from "./version.ts";

/** True only for an interactive terminal that has not opted out of color. */
export function ansiEnabled(): boolean {
  if (!process.stdout.isTTY) return false;
  const noColor = process.env["NO_COLOR"];
  if (noColor !== undefined && noColor !== "") return false;
  return process.env["CI"] !== "true";
}

const SGR = { bold: "1", dim: "2", red: "31", green: "32", yellow: "33", cyan: "36" } as const;
type SgrCode = (typeof SGR)[keyof typeof SGR];

function paint(enabled: boolean, code: SgrCode, text: string): string {
  return enabled ? `\x1b[${code}m${text}\x1b[0m` : text;
}

export function bold(text: string): string {
  return paint(ansiEnabled(), SGR.bold, text);
}

export function dim(text: string): string {
  return paint(ansiEnabled(), SGR.dim, text);
}

export function cyan(text: string): string {
  return paint(ansiEnabled(), SGR.cyan, text);
}

/** How a finished step reads. One vocabulary for glyphs, colors, and exit codes. */
export type Severity = "ok" | "warn" | "fail";

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
  { label: "nyte login [provider]", detail: "sign in (default: openai-codex)" },
  { label: "nyte logout [provider]", detail: "remove the stored credential" },
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
  { label: "--effort <level>", detail: "set thinking level" },
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
    `  ${paint(color, SGR.dim, "a missing -p prompt is read from stdin")}`,
  ].join("\n");
}
