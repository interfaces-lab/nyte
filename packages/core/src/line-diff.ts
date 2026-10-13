import type { Hunk } from "@nyte-ai/schema";

type Line = Hunk["lines"][number];

/** The context lines around each change in a hunk. */
const CONTEXT = 3;

/** The most edits the line diff searches before answering the whole middle as replaced. */
const MAX_EDITS = 4_000;

/** Diffs two texts by line (Myers, after trimming the common head and tail) into unified hunks with three lines of context; a line missing its final newline carries `noNewline`. Under `ignoreWhitespace` lines compare with their whitespace removed. */
export function lineDiff(
  before: string,
  after: string,
  options?: { readonly ignoreWhitespace?: boolean },
): { readonly hunks: readonly Hunk[]; readonly added: number; readonly removed: number } {
  const old = splitLines(before);
  const next = splitLines(after);

  const key = (line: { readonly text: string; readonly last: boolean }): string =>
    `${options?.ignoreWhitespace === true ? line.text.replace(/\s+/g, "") : line.text}${line.last ? "\u0000" : ""}`;

  const ops = edits(old.map(key), next.map(key));
  const script: { readonly kind: Line["kind"]; readonly old: number; readonly new: number }[] = [];
  let oldIndex = 0;
  let newIndex = 0;

  for (const op of ops) {
    script.push({ kind: op, old: oldIndex, new: newIndex });

    if (op !== "add") oldIndex += 1;

    if (op !== "remove") newIndex += 1;
  }

  const hunks: Hunk[] = [];
  let added = 0;
  let removed = 0;
  let index = 0;

  while (index < script.length) {
    if (script[index]?.kind === "context") {
      index += 1;
      continue;
    }

    const start = Math.max(0, index - CONTEXT);
    let end = index;
    let scan = index;

    while (scan < script.length) {
      if (script[scan]?.kind !== "context") {
        end = scan;
        scan += 1;
        continue;
      }

      let after = scan;

      while (after < script.length && script[after]?.kind === "context") after += 1;

      if (after < script.length && after - scan <= CONTEXT * 2) {
        scan = after;
        continue;
      }

      break;
    }

    const stop = Math.min(script.length, end + 1 + CONTEXT);
    const slice = script.slice(start, stop);
    const first = slice[0];

    if (first === undefined) break;

    const lines: Line[] = slice.map((step) => {
      const line = step.kind === "add" ? next[step.new] : old[step.old];
      const text = line?.text ?? "";

      if (step.kind === "add") added += 1;

      if (step.kind === "remove") removed += 1;

      return line?.last === true
        ? { kind: step.kind, text, noNewline: true }
        : { kind: step.kind, text };
    });

    const oldLines = slice.filter((step) => step.kind !== "add").length;
    const newLines = slice.filter((step) => step.kind !== "remove").length;

    hunks.push({
      oldStart: oldLines === 0 ? first.old : first.old + 1,
      oldLines,
      newStart: newLines === 0 ? first.new : first.new + 1,
      newLines,
      header: null,
      lines,
    });
    index = stop;
  }

  return { hunks, added, removed };
}

/** Returns the edit script between two key lists: `context` for a kept line, `remove`, `add`. */
function edits(old: readonly string[], next: readonly string[]): readonly Line["kind"][] {
  let head = 0;

  while (head < old.length && head < next.length && old[head] === next[head]) head += 1;
  let tail = 0;

  while (
    tail < old.length - head &&
    tail < next.length - head &&
    old[old.length - 1 - tail] === next[next.length - 1 - tail]
  )
    tail += 1;

  const a = old.slice(head, old.length - tail);
  const b = next.slice(head, next.length - tail);

  const middle = myers(a, b) ?? [
    ...a.map((): Line["kind"] => "remove"),
    ...b.map((): Line["kind"] => "add"),
  ];

  return [
    ...Array.from({ length: head }, (): Line["kind"] => "context"),
    ...middle,
    ...Array.from({ length: tail }, (): Line["kind"] => "context"),
  ];
}

/** Returns Myers' shortest edit script between two lists, or null past `MAX_EDITS` edits. */
function myers(a: readonly string[], b: readonly string[]): Line["kind"][] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, MAX_EDITS);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  v[offset + 1] = 0;

  for (let d = 0; d <= max; d += 1) {
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1]
          : v[offset + k - 1] + 1;

      let y = x - k;

      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }

      v[offset + k] = x;

      if (x >= n && y >= m) {
        trace.push(v.slice(offset - d, offset + d + 1));

        return backtrack(trace, n, m);
      }
    }

    trace.push(v.slice(offset - d, offset + d + 1));
  }

  return null;
}

function backtrack(trace: readonly Int32Array[], n: number, m: number): Line["kind"][] {
  const script: Line["kind"][] = [];
  let x = n;
  let y = m;

  for (let d = trace.length - 1; d > 0; d -= 1) {
    const previous = trace[d - 1];

    if (previous === undefined) break;
    const at = (k: number): number => previous[k + d - 1];
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const previousK = down ? k + 1 : k - 1;
    const previousX = at(previousK);
    const previousY = previousX - previousK;

    while (x > previousX && y > previousY) {
      script.push("context");
      x -= 1;
      y -= 1;
    }

    script.push(down ? "add" : "remove");
    x = previousX;
    y = previousY;
  }

  while (x > 0 && y > 0) {
    script.push("context");
    x -= 1;
    y -= 1;
  }

  return script.reverse();
}

/** Splits a text into lines without their newlines, marking the last; an empty text has none. */
function splitLines(text: string): readonly { readonly text: string; readonly last: boolean }[] {
  if (text === "") return [];
  const parts = text.split("\n");

  if (parts.at(-1) === "") parts.pop();

  return parts.map((part, index) => ({
    text: part,
    last: index === parts.length - 1 && !text.endsWith("\n"),
  }));
}
