import { parsePatch } from "diff";
import { presentTool as presentToolView, projectToolView } from "@nyte-ai/core/views";
import type { ToolProgress, ToolTurnPart } from "@nyte-ai/core";

export interface ParsedDiff {
  readonly patch: string;
  readonly added: number;
  readonly removed: number;
}

export type ToolBody =
  | { kind: "none" }
  | { kind: "output"; text: string }
  | { kind: "diff"; path: string; diff: ParsedDiff };

export interface ToolPresentation {
  readonly verb: string;
  readonly detail: string | undefined;
  readonly detailTitle: string | undefined;
  readonly state: "running" | "done" | "failed";
  readonly added: number | undefined;
  readonly removed: number | undefined;
  readonly body: ToolBody;
}

const VERBS = {
  read: { running: "Reading", done: "Read", failed: "Read failed" },
  bash: { running: "Running", done: "Ran", failed: "Command failed" },
  edit: { running: "Editing", done: "Edited", failed: "Edit failed" },
  write: { running: "Writing", done: "Wrote", failed: "Write failed" },
  ls: { running: "Listing", done: "Listed", failed: "List failed" },
} satisfies Record<string, Record<ToolPresentation["state"], string>>;

/** What a run of one tool is called when a group summarises several. */
const NOUNS = {
  read: { one: "read", many: "reads" },
  bash: { one: "command", many: "commands" },
  edit: { one: "edit", many: "edits" },
  write: { one: "write", many: "writes" },
  ls: { one: "listing", many: "listings" },
} satisfies Record<keyof typeof VERBS, { readonly one: string; readonly many: string }>;

function isKnownToolName(name: string): name is keyof typeof VERBS {
  return Object.hasOwn(VERBS, name);
}

export function toolNoun(name: string, count: number): string {
  const noun = isKnownToolName(name) ? NOUNS[name] : undefined;
  if (noun !== undefined) return count === 1 ? noun.one : noun.many;
  const label = name.startsWith("mcp__") ? humanizeToolName(name) : words(name).toLocaleLowerCase();
  return count === 1 ? label : `${label}s`;
}

/**
 * A tool name the VERBS table does not cover still has to read as English.
 * MCP names arrive as `mcp__server__tool`; everything else as snake or kebab
 * case.
 */
export function humanizeToolName(name: string): string {
  const mcp = /^mcp__(?<server>[^_]+(?:_[^_]+)*)__(?<tool>.+)$/.exec(name);
  if (mcp?.groups !== undefined) {
    const { server, tool } = mcp.groups;
    return `${capitalize(words(server))}: ${words(tool)}`;
  }
  return capitalize(words(name));
}

function words(name: string): string {
  return name.replaceAll(/[_-]+/g, " ").trim();
}

function capitalize(text: string): string {
  return text.slice(0, 1).toLocaleUpperCase() + text.slice(1);
}

const PATCH_CACHE_LIMIT = 64;
const patchCache = new Map<string, ParsedDiff | null>();

function rememberPatch(patch: string, parsed: ParsedDiff | null): void {
  patchCache.set(patch, parsed);
  if (patchCache.size <= PATCH_CACHE_LIMIT) return;
  const oldest = patchCache.keys().next().value;
  if (oldest !== undefined) patchCache.delete(oldest);
}

function tidyPath(path: string, cwd: string | undefined): string {
  if (cwd !== undefined && path.startsWith(`${cwd}/`)) return path.slice(cwd.length + 1);
  return path;
}

function basename(path: string): string {
  return path.split(/[\\/]/u).at(-1) ?? path;
}

export function parseUnifiedPatch(patch: string): ParsedDiff | undefined {
  const cached = patchCache.get(patch);
  if (cached !== undefined) {
    patchCache.delete(patch);
    patchCache.set(patch, cached);
    return cached ?? undefined;
  }
  let files;
  try {
    files = parsePatch(patch);
  } catch {
    rememberPatch(patch, null);
    return undefined;
  }
  let added = 0;
  let removed = 0;
  for (const file of files) {
    for (const hunk of file.hunks) {
      for (const raw of hunk.lines) {
        const marker = raw[0];
        if (marker === "+") {
          added += 1;
        } else if (marker === "-") {
          removed += 1;
        }
      }
    }
  }
  const parsed = added === 0 && removed === 0 ? null : { patch, added, removed };
  rememberPatch(patch, parsed);
  return parsed ?? undefined;
}

export function presentTool(
  part: ToolTurnPart,
  progress: ToolProgress | undefined,
  cwd: string | undefined,
): ToolPresentation {
  const presented = presentToolView(projectToolView(part, progress));
  const verbs = isKnownToolName(presented.name) ? VERBS[presented.name] : undefined;
  const humanName = humanizeToolName(presented.name);
  const verb =
    verbs === undefined
      ? presented.status === "failed"
        ? `${humanName} failed`
        : humanName
      : verbs[presented.status];
  const fullDetail =
    presented.detail === undefined ? presented.title : tidyPath(presented.detail, cwd);
  const fileEdit = presented.name === "edit" || presented.name === "write";
  const detail = fileEdit && fullDetail !== undefined ? basename(fullDetail) : fullDetail;
  const detailTitle = detail === fullDetail ? undefined : fullDetail;

  if (presented.body.kind === "diff") {
    const diff = parseUnifiedPatch(presented.body.patch);
    if (diff !== undefined) {
      return {
        verb,
        detail,
        detailTitle,
        state: presented.status,
        added: diff.added === 0 ? undefined : diff.added,
        removed: diff.removed === 0 ? undefined : diff.removed,
        body: {
          kind: "diff",
          path: tidyPath(presented.body.path ?? fullDetail ?? presented.name, cwd),
          diff,
        },
      };
    }
  }

  const text =
    presented.body.kind === "text"
      ? presented.body.text
      : presented.body.kind === "diff"
        ? (part.result?.output ?? "")
        : "";
  return {
    verb,
    detail,
    detailTitle,
    state: presented.status,
    added: undefined,
    removed: undefined,
    body: text.trim() === "" ? { kind: "none" } : { kind: "output", text },
  };
}
