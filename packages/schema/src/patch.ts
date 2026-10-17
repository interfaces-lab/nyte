import { Type } from "typebox";
import type { FileStatus } from "./files.ts";
import type { Decoded } from "./schema.ts";
import { nullable } from "./wire/nullable.ts";

export const HunkType = Type.Object({
  oldStart: Type.Number(),
  oldLines: Type.Number(),
  newStart: Type.Number(),
  newLines: Type.Number(),
  header: nullable(Type.String()),
  lines: Type.Array(
    Type.Object({
      kind: Type.Enum(["context", "add", "remove"]),
      text: Type.String(),
      noNewline: Type.Optional(Type.Literal(true)),
    }),
  ),
});

/** One hunk of a unified diff: where it sits on each side, the text after its `@@` header, and its lines, `noNewline` on a line the file ends without a newline after. */
export type Hunk = Decoded<typeof HunkType>;

type Line = Hunk["lines"][number];

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

const MARKS = { add: "+", remove: "-", context: " " } as const;

/** Writes one file's unified diff as `git diff` prints it: the `diff --git` header, the `---`/`+++` sides (`/dev/null` for an added, untracked or deleted file) and the hunks. */
export function writePatch(path: string, status: FileStatus, hunks: readonly Hunk[]): string {
  const before = status === "added" || status === "untracked" ? "/dev/null" : `a/${path}`;
  const after = status === "deleted" ? "/dev/null" : `b/${path}`;
  const lines = [`diff --git a/${path} b/${path}`, `--- ${before}`, `+++ ${after}`];

  for (const hunk of hunks) {
    const header = hunk.header === null ? "" : ` ${hunk.header}`;

    lines.push(
      `@@ -${String(hunk.oldStart)},${String(hunk.oldLines)} +${String(hunk.newStart)},${String(hunk.newLines)} @@${header}`,
    );

    for (const line of hunk.lines) {
      lines.push(`${MARKS[line.kind]}${line.text}`);

      if (line.noNewline === true) lines.push("\\ No newline at end of file");
    }
  }

  return `${lines.join("\n")}\n`;
}

/** Reads the hunks of one file's unified diff, the text a `PatchEntry` of kind `text` carries as `patch`. */
export function readHunks(patch: string): readonly Hunk[] {
  const lines = patch.split("\n");

  if (lines.at(-1) === "") lines.pop();
  const hunks: Hunk[] = [];
  let index = 0;

  while (index < lines.length) {
    const header = HUNK_HEADER.exec(lines[index] ?? "");

    if (header === null) {
      index += 1;
      continue;
    }

    const oldLines = header[2] === undefined ? 1 : Number(header[2]);
    const newLines = header[4] === undefined ? 1 : Number(header[4]);
    const body: Line[] = [];
    let oldSeen = 0;
    let newSeen = 0;
    index += 1;

    while (index < lines.length) {
      const line = lines[index] ?? "";

      if (line.startsWith("\\")) {
        const last = body.pop();

        if (last !== undefined) body.push({ ...last, noNewline: true });
        index += 1;
        continue;
      }

      if (oldSeen >= oldLines && newSeen >= newLines) break;
      const mark = line[0];

      if (mark === "+") {
        body.push({ kind: "add", text: line.slice(1) });
        newSeen += 1;
      } else if (mark === "-") {
        body.push({ kind: "remove", text: line.slice(1) });
        oldSeen += 1;
      } else if (mark === " " || line === "") {
        body.push({ kind: "context", text: line.slice(1) });
        oldSeen += 1;
        newSeen += 1;
      } else break;
      index += 1;
    }

    const text = header[5] ?? "";

    hunks.push({
      oldStart: Number(header[1]),
      oldLines,
      newStart: Number(header[3]),
      newLines,
      header: text === "" ? null : text,
      lines: body,
    });
  }

  return hunks;
}
