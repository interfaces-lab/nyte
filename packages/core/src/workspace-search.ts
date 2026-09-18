import { realpath } from "node:fs/promises";
import { isAbsolute, matchesGlob, relative, resolve, sep } from "node:path";
import type {
  WorkspaceSearchInput,
  WorkspaceSearchMatch,
  WorkspaceSearchResult,
} from "@nyte-ai/protocol";
import { findRipgrepFiles, grepRipgrep, InvalidRipgrepPattern, resolveRipgrep } from "./ripgrep.ts";
import {
  MAX_WORKSPACE_FILE_BYTES,
  resolveWorkspaceFile,
  WorkspaceFileError,
} from "./workspace-files.ts";

export {
  WorkspaceSearchSchema,
  type WorkspaceSearchInput,
  type WorkspaceSearchMatch,
  type WorkspaceSearchResult,
} from "@nyte-ai/protocol";

export class WorkspaceSearchError extends Error {
  readonly reason: "invalid_query" | "invalid_regex";

  constructor(reason: "invalid_query" | "invalid_regex", message: string) {
    super(message);
    this.name = "WorkspaceSearchError";
    this.reason = reason;
  }
}

/** Direct rg disk results, with UTF-16 selections and eligible draft overrides.
 * Disk traversal is not a sandbox against concurrent directory replacement.
 */
export async function searchWorkspaceFiles(
  workspacePath: string,
  input: WorkspaceSearchInput,
  signal: AbortSignal = new AbortController().signal,
): Promise<WorkspaceSearchResult> {
  signal.throwIfAborted();
  if (input.query.includes("\0") || /[\r\n]/u.test(input.query))
    throw new WorkspaceSearchError(
      "invalid_query",
      "Search queries must not contain NUL or newline characters",
    );
  const cwd = await realpath(workspacePath);
  const drafts = new Map<string, string>();
  let draftBytes = 0;
  for (const draft of input.drafts ?? []) {
    draftBytes += Buffer.byteLength(draft.contents);
    if (draftBytes > MAX_WORKSPACE_FILE_BYTES) throw new WorkspaceFileError("drafts_too_large");
    drafts.set(await resolveWorkspaceFile(cwd, draft.path), draft.contents);
  }
  // A first-run installation must not consume the search's five-second budget.
  await resolveRipgrep(signal);
  signal.throwIfAborted();
  const timeout = AbortSignal.timeout(5_000);
  const searchSignal = AbortSignal.any([signal, timeout]);
  const files = new Map<
    string,
    {
      path: string;
      displayPath: string;
      source: "disk" | "draft";
      matches: WorkspaceSearchMatch[];
    }
  >();
  const maxMatches = input.maxMatches ?? 500;
  let matchCount = 0;
  let truncated = false;
  function included(displayPath: string) {
    return (
      (input.include === undefined ||
        input.include.length === 0 ||
        input.include.some((glob) => matchesGlob(displayPath, glob))) &&
      !input.exclude?.some((glob) => matchesGlob(displayPath, glob))
    );
  }
  const search = async (draft?: { path: string; contents: string }) => {
    const result = await grepRipgrep({
      cwd,
      source:
        draft === undefined
          ? { kind: "directory", maxFileBytes: MAX_WORKSPACE_FILE_BYTES }
          : {
              kind: "text",
              text: draft.contents.endsWith("\n") ? draft.contents : `${draft.contents}\n`,
            },
      pattern: input.query,
      literal: input.regex !== true,
      caseSensitive: input.caseSensitive === true,
      wholeWord: input.wholeWord === true,
      signal: searchSignal,
      onMatch(data) {
        if (!("text" in data.path) || !("text" in data.lines)) return true;
        const path = draft?.path ?? resolve(cwd, data.path.text);
        const inside = relative(cwd, path);
        if (inside === "" || isAbsolute(inside) || inside === ".." || inside.startsWith(`..${sep}`))
          throw new Error("Ripgrep returned a path outside the workspace");
        const displayPath = inside.split(sep).join("/");
        if (!included(displayPath) || (draft === undefined && drafts.has(path))) return true;
        const text = data.lines.text.replace(/\r?\n$/u, "");
        const line = Buffer.from(text);
        // rg reports a matching unterminated line but omits its final zero-width
        // submatch. No other position can be recovered from an empty submatch list.
        const submatches =
          data.submatches.length === 0 && !data.lines.text.endsWith("\n")
            ? [{ start: line.length, end: line.length }]
            : data.submatches;
        for (const match of submatches) {
          if (match.end < match.start || match.end > line.length)
            throw new Error("Ripgrep returned invalid match offsets");
          if (matchCount >= maxMatches) return false;
          const start = line.subarray(0, match.start).toString("utf8").length;
          const length = line.subarray(match.start, match.end).toString("utf8").length;
          const snippetStart = Math.max(0, start - 80);
          let file = files.get(path);
          if (file === undefined) {
            file = {
              path,
              displayPath,
              source: draft === undefined ? "disk" : "draft",
              matches: [],
            };
            files.set(path, file);
          }
          file.matches.push({
            line: data.line_number,
            column: start + 1,
            length,
            snippet: text.slice(snippetStart, snippetStart + 240),
            snippetColumn: snippetStart + 1,
          });
          matchCount += 1;
        }
        return true;
      },
    });
    truncated ||= result.truncated;
  };
  try {
    // Only draft eligibility needs enumeration; disk search uses rg directly.
    if (drafts.size > 0) {
      const listing = await findRipgrepFiles({ cwd, signal: searchSignal });
      truncated ||= listing.truncated;
      for (const candidate of listing.files.toSorted()) {
        const path = resolve(cwd, candidate);
        const contents = drafts.get(path);
        if (contents === undefined || contents.includes("\0") || !included(candidate)) continue;
        await search({ path, contents });
        if (matchCount >= maxMatches && truncated) break;
      }
    }
    // This also validates regexes when filters select no files.
    if (!(matchCount >= maxMatches && truncated)) await search();
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof InvalidRipgrepPattern)
      throw new WorkspaceSearchError("invalid_regex", error.message);
    if (!timeout.aborted) throw error;
    truncated = true;
  }
  return {
    files: [...files.values()].toSorted((left, right) =>
      left.displayPath.localeCompare(right.displayPath),
    ),
    matchCount,
    truncated,
    // rg does not report exact counts of ignored, binary, oversized or unreadable
    // files. Null must not be presented as zero skipped files.
    skipped: null,
  };
}
