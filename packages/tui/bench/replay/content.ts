import { createTwoFilesPatch } from "diff";

const PARAGRAPH =
  "The renderer walks the tree once per frame, measuring text with **bold** and `inline code`, then lays out each block. ";

export function userText(index: number): string {
  return `Please do step ${String(index)} of the plan and show the code.`;
}

export function answerText(index: number): string {
  return [
    `### Step ${String(index)}`,
    PARAGRAPH.repeat(3),
    "- first item with a [link](https://example.com)",
    "- second item, a little longer than the first one",
    "- third item",
    "",
    "```ts",
    `export function step${String(index)}(input: number): number {`,
    "  const doubled = input * 2;",
    "  return doubled + 1;",
    "}",
    "```",
    "",
    "| column | value |",
    "| --- | --- |",
    `| turn | ${String(index)} |`,
    "",
    PARAGRAPH,
  ].join("\n");
}

export const STREAM_TOKENS = 1_500;

export function streamedText(): string {
  return Array.from({ length: 12 }, (_, index) => answerText(index)).join("\n\n");
}

export const BIG_FILE = "big.ts";

const BIG_LINES = 1_500;

export function bigBefore(): string {
  return `${Array.from({ length: BIG_LINES }, (_, i) => `export const value${String(i)} = ${String(i)};`).join("\n")}\n`;
}

export function bigAfter(): string {
  return `${Array.from({ length: BIG_LINES }, (_, i) =>
    i % 3 === 0
      ? `export const value${String(i)} = ${String(i * 2)}; // changed`
      : `export const value${String(i)} = ${String(i)};`,
  ).join("\n")}\n`;
}

export function bigPatch(): string {
  const patch = createTwoFilesPatch(`a/${BIG_FILE}`, `b/${BIG_FILE}`, bigBefore(), bigAfter());

  return `diff --git a/${BIG_FILE} b/${BIG_FILE}\n${patch.split("\n").slice(1).join("\n")}`;
}

export const TYPED = "Refactor the parser so it streams tokens and keeps the old API working";
