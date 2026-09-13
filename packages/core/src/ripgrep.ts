/** Based on https://github.com/anomalyco/opencode/blob/0643a5638e0cd02234e73f176771527d7600faf7/packages/core/src/ripgrep.ts */
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { relative, resolve, sep } from "node:path";
import { Compile } from "typebox/compile";
import { Type } from "typebox";
import type { Static } from "typebox";
import { resolveRipgrep } from "./ripgrep/binary.ts";

export { resolveRipgrep } from "./ripgrep/binary.ts";

export class InvalidRipgrepPattern extends Error {
  constructor(message: string) {
    super(`Invalid search regular expression: ${message}`);
    this.name = "InvalidRipgrepPattern";
  }
}

/** Stream bounded records. Returning false stops the process, including its unread output. */
async function runRipgrep(input: {
  readonly executable: string;
  readonly cwd: string;
  readonly args: readonly string[];
  readonly signal: AbortSignal;
  readonly separator?: string;
  readonly stdin?: string;
  readonly onRecord: (record: string) => boolean;
}): Promise<{ readonly truncated: boolean }> {
  input.signal.throwIfAborted();
  const child = spawn(input.executable, ["--no-config", ...input.args], {
    cwd: input.cwd,
    shell: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    signal: input.signal,
    killSignal: "SIGKILL",
  });
  // Observe exit immediately, including spawn failures while stdout is being consumed.
  let processError: Error | undefined;
  const exited = new Promise<number | null>((resolve) => {
    child.on("error", (error) => {
      processError = error;
    });
    child.on("close", resolve);
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(0, 8_192);
  });
  // rg can reject a pattern or stop searching before consuming the whole draft.
  child.stdin.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE" && error.code !== "ERR_STREAM_DESTROYED") child.kill("SIGKILL");
  });
  child.stdin.end(input.stdin);
  const decoder = new StringDecoder("utf8");
  const separator = input.separator ?? "\n";
  let pending = "";
  let bytes = 0;
  let truncated = false;
  try {
    outer: for await (const chunk of child.stdout) {
      if (!Buffer.isBuffer(chunk)) throw new Error("Invalid ripgrep output chunk");
      bytes += chunk.length;
      // JSON submatches on a single repetitive line can dwarf the source file.
      if (bytes > 8_000_000) {
        truncated = true;
        break;
      }
      pending += decoder.write(chunk);
      let boundary: number;
      while ((boundary = pending.indexOf(separator)) !== -1) {
        const record = pending.slice(0, boundary);
        pending = pending.slice(boundary + separator.length);
        if (record.length > 0 && !input.onRecord(record)) {
          truncated = true;
          break outer;
        }
      }
    }
    if (!truncated) {
      pending += decoder.end();
      if (pending.length > 0) truncated = !input.onRecord(pending);
    }
    if (truncated) child.kill("SIGKILL");
    const code = await exited;
    input.signal.throwIfAborted();
    if (processError) throw processError;
    if (truncated) return { truncated: true };
    if (
      code === 2 &&
      /regex parse error|error parsing regex|not allowed in a regex/u.test(stderr)
    ) {
      throw new InvalidRipgrepPattern(stderr.trim());
    }
    // Exit 2 can accompany usable records, for example when one directory is unreadable.
    if (code !== 0 && code !== 1 && code !== 2) {
      throw new Error(`Ripgrep failed with code ${String(code)}: ${stderr.trim()}`);
    }
    return { truncated: code === 2 };
  } catch (error) {
    input.signal.throwIfAborted();
    throw error;
  } finally {
    child.kill("SIGKILL");
    await exited;
  }
}

const rawRecord = Compile(Type.Object({ type: Type.String() }));
const rawText = Type.Union([
  Type.Object({ text: Type.String() }),
  Type.Object({ bytes: Type.String() }),
]);
const rawMatchSchema = Type.Object({
  path: rawText,
  lines: rawText,
  line_number: Type.Integer({ minimum: 1 }),
  submatches: Type.Array(
    Type.Object({
      start: Type.Integer({ minimum: 0 }),
      end: Type.Integer({ minimum: 0 }),
    }),
  ),
});
const rawMatch = Compile(Type.Object({ data: rawMatchSchema }));
export type RipgrepMatch = Static<typeof rawMatchSchema>;

/** Higher-level search converts these byte offsets to editor selection coordinates. */
export async function grepRipgrep(input: {
  readonly cwd: string;
  readonly pattern: string;
  readonly literal?: boolean;
  readonly caseSensitive?: boolean;
  readonly wholeWord?: boolean;
  readonly source:
    | { readonly kind: "directory"; readonly maxFileBytes?: number }
    | { readonly kind: "text"; readonly text: string };
  readonly signal: AbortSignal;
  readonly onMatch: (match: RipgrepMatch) => boolean;
}): Promise<{ readonly truncated: boolean }> {
  if (input.pattern.includes("\0") || /[\r\n]/u.test(input.pattern))
    throw new InvalidRipgrepPattern("Search queries must not contain NUL or newline characters");
  return runRipgrep({
    executable: await resolveRipgrep(input.signal),
    cwd: input.cwd,
    args: [
      "--json",
      "--engine=default",
      // Disk BOMs are decoded like editor reads; unsaved text keeps its literal BOM.
      input.source.kind === "directory" ? "--encoding=utf-8" : "--encoding=none",
      "--crlf",
      "--no-mmap",
      ...(input.source.kind === "directory" && input.source.maxFileBytes !== undefined
        ? [`--max-filesize=${input.source.maxFileBytes}`]
        : []),
      "--hidden",
      "--no-ignore-parent",
      "--no-ignore-global",
      "--no-require-git",
      "--glob=!**/.git",
      // Stabilize which matches survive a caller's limit, not just their display order.
      "--sort=path",
      ...(input.literal ? ["--fixed-strings"] : []),
      ...(input.caseSensitive === false ? ["--ignore-case"] : []),
      ...(input.wholeWord ? ["--word-regexp"] : []),
      "--",
      input.pattern,
      input.source.kind === "directory" ? "." : "-",
    ],
    signal: input.signal,
    ...(input.source.kind === "text" ? { stdin: input.source.text } : {}),
    onRecord(record) {
      const json: unknown = JSON.parse(record);
      if (rawRecord.Parse(json).type !== "match") return true;
      return input.onMatch(rawMatch.Parse(json).data);
    },
  });
}

/** Enumerate before applying client include globs, which must not re-include ignored files. */
export async function findRipgrepFiles(input: {
  readonly cwd: string;
  readonly limit?: number;
  readonly hidden?: boolean;
  readonly glob?: string;
  readonly exclude?: readonly string[];
  readonly signal?: AbortSignal;
}): Promise<{ readonly files: readonly string[]; readonly truncated: boolean }> {
  const signal = input.signal ?? new AbortController().signal;
  const files: string[] = [];
  const result = await runRipgrep({
    executable: await resolveRipgrep(signal),
    cwd: input.cwd,
    args: [
      "--files",
      "--null",
      ...(input.hidden === false ? [] : ["--hidden"]),
      "--no-ignore-parent",
      "--no-ignore-global",
      "--no-require-git",
      ...(input.glob === undefined ? [] : [`--glob=${input.glob}`]),
      ...(input.exclude ?? []).map((pattern) => `--glob=!${pattern}`),
      // A positive glob otherwise overrides rg's hidden-file filter.
      ...(input.hidden === false ? ["--glob=!**/.*"] : []),
      "--glob=!**/.git",
      ".",
    ],
    signal,
    separator: "\0",
    onRecord(path) {
      if (files.length >= (input.limit ?? Number.MAX_SAFE_INTEGER)) return false;
      files.push(relative(input.cwd, resolve(input.cwd, path)).split(sep).join("/"));
      return true;
    },
  });
  return { files, truncated: result.truncated };
}
