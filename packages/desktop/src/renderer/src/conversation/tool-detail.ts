import {
  createPresenter,
  parsePatchFacts,
  projectToolView,
  runActivityLabel,
  subagentToolKind,
  type ParsedPatch,
} from "@nyte-ai/client";
import type { SessionId, ToolProgress, ToolTurnPart } from "@nyte-ai/protocol";
import type { JsonValue } from "@nyte-ai/schema";
import { sessionId } from "@nyte-ai/protocol";

export type ParsedDiff = Pick<ParsedPatch, "patch" | "added" | "removed">;

type ToolBody =
  | { kind: "none" }
  | { kind: "output"; text: string }
  | { kind: "diff"; path: string; diff: ParsedDiff };

export interface ToolPresentation {
  readonly verb: string;
  readonly detail: string | undefined;
  readonly detailTitle: string | undefined;
  readonly state: "running" | "done" | "failed" | "stopped";
  readonly added: number | undefined;
  readonly removed: number | undefined;
  readonly body: ToolBody;
}

const VERBS = {
  read: { running: "Reading", done: "Read", failed: "Read failed", stopped: "Read stopped" },
  bash: { running: "Running", done: "Ran", failed: "Command failed", stopped: "Command stopped" },
  edit: { running: "Editing", done: "Edited", failed: "Edit failed", stopped: "Edit stopped" },
  write: { running: "Writing", done: "Wrote", failed: "Write failed", stopped: "Write stopped" },
  ls: { running: "Listing", done: "Listed", failed: "List failed", stopped: "List stopped" },
} satisfies Record<string, Record<ToolPresentation["state"], string>>;

/** The status verb for the tools currently running, newest last. */
export function activityVerb(runningToolNames: readonly string[]): string | undefined {
  const known = runActivityLabel(runningToolNames);
  if (known !== undefined) return known;
  const newest = runningToolNames.at(-1);
  return newest === undefined ? undefined : `Running ${humanizeToolName(newest)}`;
}

function isJsonObject(
  value: JsonValue | undefined,
): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * What a delegation says about its subagent, drawn as its own row either way.
 * A spawn names the title the model gave the task, else the model it selected,
 * which is also what the job and the child's result carry. An await names only
 * a job id, so the jobs list supplies the rest.
 */
export type SubagentCall =
  | {
      readonly kind: "spawn";
      readonly title: string;
      /** Known once the tool has reported the child it spawned. */
      readonly childSessionId: SessionId | undefined;
    }
  | { readonly kind: "await"; readonly jobId: string };

export function subagentCall(
  part: ToolTurnPart,
  progress: ToolProgress | undefined,
): SubagentCall | undefined {
  const kind = subagentToolKind(part.toolName);
  const args = isJsonObject(part.args) ? part.args : {};
  switch (kind) {
    case "await": {
      const { jobId } = args;
      return typeof jobId === "string" && jobId !== "" ? { kind: "await", jobId } : undefined;
    }
    case "spawn": {
      const title = [args.title, args.model].find(
        (value): value is string => typeof value === "string" && value !== "",
      );
      return {
        kind: "spawn",
        title: title ?? "Subagent",
        childSessionId: childSessionId(part, progress),
      };
    }
    case undefined:
      return undefined;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function childSessionId(
  part: ToolTurnPart,
  progress: ToolProgress | undefined,
): SessionId | undefined {
  for (const details of [part.result?.details, progress?.details]) {
    if (!isJsonObject(details)) continue;
    const id = details.childSessionId;
    if (typeof id === "string" && id !== "") return sessionId(id);
  }
  return undefined;
}

function isKnownToolName(name: string): name is keyof typeof VERBS {
  return Object.hasOwn(VERBS, name);
}

/**
 * A tool name the VERBS table does not cover still has to read as English.
 * MCP names arrive as `mcp__server__tool`; everything else as snake or kebab
 * case.
 */
function humanizeToolName(name: string): string {
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
  const facts = parsePatchFacts(patch);
  const parsed =
    facts === undefined || (facts.added === 0 && facts.removed === 0)
      ? null
      : { patch: facts.patch, added: facts.added, removed: facts.removed };
  rememberPatch(patch, parsed);
  return parsed ?? undefined;
}

const presenter = createPresenter();

export function presentTool(
  part: ToolTurnPart,
  progress: ToolProgress | undefined,
  cwd: string | undefined,
  active = true,
): ToolPresentation {
  const presented = presenter.tool(projectToolView(part, progress));
  const state = presented.status === "running" && !active ? "stopped" : presented.status;
  const verbs = isKnownToolName(presented.name) ? VERBS[presented.name] : undefined;
  const humanName = humanizeToolName(presented.name);
  const verb =
    verbs === undefined
      ? state === "failed" || state === "stopped"
        ? `${humanName} ${state}`
        : humanName
      : verbs[state];
  const fullDetail =
    presented.name === "websearch" && presented.title !== undefined
      ? presented.title
      : presented.detail === undefined
        ? presented.title
        : tidyPath(presented.detail, cwd);
  const fileEdit = presented.name === "edit" || presented.name === "write";
  const detail = fileEdit && fullDetail !== undefined ? basename(fullDetail) : fullDetail;
  const detailTitle = detail === fullDetail ? undefined : fullDetail;

  if (presented.body.kind === "diff") {
    const diff = presented.body;
    return {
      verb,
      detail,
      detailTitle,
      state,
      added: diff.added === 0 ? undefined : diff.added,
      removed: diff.removed === 0 ? undefined : diff.removed,
      body: {
        kind: "diff",
        path: tidyPath(diff.path ?? fullDetail ?? presented.name, cwd),
        diff,
      },
    };
  }

  const text = presented.body.kind === "text" ? presented.body.text : "";
  return {
    verb,
    detail,
    detailTitle,
    state,
    added: undefined,
    removed: undefined,
    body: text.trim() === "" ? { kind: "none" } : { kind: "output", text },
  };
}
