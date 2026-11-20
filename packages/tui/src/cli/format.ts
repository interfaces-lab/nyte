import type { Json } from "@nyte-ai/sdk";
import { GLYPHS } from "../lib/constants.ts";
import { errorClass, jsonStatus, shellCommand } from "./errors.ts";
import type { CliError, NextStep, Reason } from "./errors.ts";
import type { Presentation } from "./mode.ts";

export type Gutter = "none" | "done" | "warn" | "fail" | "prompt";

export interface Row {
  readonly gutter?: Gutter;
  readonly label: string;
  readonly value: string;
}

const SGR = {
  bold: "1",
  red: "31",
  green: "32",
  yellow: "33",
  magenta: "35",
  cyan: "36",
} as const;

export type Style = keyof typeof SGR;

const GUTTERS: Readonly<
  Record<Gutter, { readonly glyph: string; readonly word: string; readonly style?: Style }>
> = {
  none: { glyph: " ", word: "" },
  done: { glyph: GLYPHS.check, word: "", style: "green" },
  warn: { glyph: "!", word: "Warning:", style: "yellow" },
  fail: { glyph: GLYPHS.cross, word: "Error:", style: "red" },
  prompt: { glyph: "?", word: "?" },
};

interface JsonNextStep {
  readonly command: string;
  readonly argv: readonly string[];
  readonly when: string;
}

interface ErrorDocument {
  readonly status: "action_required" | "error";
  readonly reason: Reason;
  readonly message: string;
  next?: readonly JsonNextStep[];
  data?: { readonly [key: string]: Json };
}

const LABEL_WIDTH = 16;

const VALUE_COLUMN = 18;

export function paint(presentation: Presentation, style: Style, text: string): string {
  return presentation.color ? `\x1b[${SGR[style]}m${text}\x1b[0m` : text;
}

export function formatRows(rows: readonly Row[], presentation: Presentation): string[] {
  return rows.flatMap((row) => {
    const gutter = row.gutter ?? "none";
    const word = GUTTERS[gutter].word;
    const plainLead = word === "" ? "  " : `${word} `;
    const lead = presentation.rich ? `${glyph(gutter, presentation)} ` : plainLead;
    const label = gutter === "done" ? paint(presentation, "bold", row.label) : row.label;
    const used = (presentation.rich ? 2 : plainLead.length) + row.label.length;

    if (row.value === "") return [`${lead}${label}`];

    if (row.label.length < LABEL_WIDTH && used < VALUE_COLUMN)
      return [`${lead}${label}${" ".repeat(VALUE_COLUMN - used)}${row.value}`];

    return [`${lead}${label}`, `${" ".repeat(VALUE_COLUMN)}${row.value}`];
  });
}

export function formatStatus(gutter: Gutter, text: string, presentation: Presentation): string {
  const style = GUTTERS[gutter];

  if (!presentation.rich) return style.word === "" ? text : `${style.word} ${text}`;

  return `${glyph(gutter, presentation)} ${gutter === "done" ? paint(presentation, "bold", text) : text}`;
}

export function formatTable(
  header: readonly string[],
  rows: readonly (readonly string[])[],
  presentation: Presentation,
  width?: number,
): string[] {
  const lines = [header, ...rows];

  if (!presentation.rich) return lines.map((cells) => cells.join("\t"));

  const widths = header.map((_, column) =>
    Math.max(...lines.map((cells) => (cells[column] ?? "").length)),
  );

  const lead = widths.slice(0, -1).reduce((total, columnWidth) => total + columnWidth + 2, 0);
  const room = width === undefined ? Infinity : Math.max(width - lead, 10);

  return lines.map((cells) =>
    cells
      .map((cell, column) => {
        if (column < cells.length - 1) return cell.padEnd((widths[column] ?? 0) + 2);

        return cell.length > room ? `${cell.slice(0, room - 1)}…` : cell;
      })
      .join(""),
  );
}

export function printable(text: string): string {
  return text.replaceAll(
    /\p{Cc}/gu,
    (character) => `\\x${(character.codePointAt(0) ?? 0).toString(16).padStart(2, "0")}`,
  );
}

export function formatCommand(argv: readonly string[], presentation: Presentation): string {
  return `    ${paint(presentation, "cyan", shellCommand(argv))}`;
}

export function formatError(error: CliError, presentation: Presentation): string {
  return [
    formatStatus(
      errorClass(error.reason) === "canceled" ? "none" : "fail",
      error.message,
      presentation,
    ),
    ...formatRows(error.details, presentation),
    ...error.next
      .slice(0, 2)
      .flatMap((step) => ["", `  ${step.label}:`, formatCommand(step.argv, presentation)]),
  ].join("\n");
}

export function formatErrorJson(error: CliError): string {
  const document: ErrorDocument = {
    status: jsonStatus(error.reason),
    reason: error.reason,
    message: error.message,
  };

  if (error.next.length > 0) document["next"] = formatNextJson(error.next);

  if (error.data !== undefined) document["data"] = error.data;
  else if (error.details.length > 0)
    document["data"] = Object.fromEntries(error.details.map((row) => [row.label, row.value]));

  return JSON.stringify(document);
}

export function formatNextJson(steps: readonly NextStep[]): JsonNextStep[] {
  return steps.map((step) => ({
    command: shellCommand(step.argv),
    argv: step.argv,
    when: step.label,
  }));
}

function glyph(gutter: Gutter, presentation: Presentation): string {
  const style = GUTTERS[gutter];

  return style.style === undefined ? style.glyph : paint(presentation, style.style, style.glyph);
}
