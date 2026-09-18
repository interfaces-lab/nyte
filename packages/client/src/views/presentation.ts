import { isJsonObject, type JsonValue } from "../json.ts";
import type { CommitBody, Oid } from "@nyte-ai/protocol";
import { readPatch } from "./changes.ts";
import { parsePatchFacts, type ParsedPatch } from "./patch.ts";
import type { ToolTurnPart } from "./transcript.ts";

export type ToolStatus = "running" | "done" | "failed";

export type ToolBody =
  | { readonly kind: "none" }
  | { readonly kind: "text"; readonly text: string }
  | (ParsedPatch & {
      readonly kind: "diff";
      readonly path?: string;
    });

export interface ToolPresentation {
  readonly name: string;
  readonly title?: string;
  readonly detail?: string;
  readonly summary?: string;
  readonly status: ToolStatus;
  readonly body: ToolBody;
}

export interface ToolLive {
  readonly text?: string;
  readonly title?: string;
}

export interface ToolResultView {
  readonly output: string;
  readonly details?: JsonValue;
  readonly title?: string;
  readonly isError: boolean;
}

export interface ToolView {
  readonly toolName: string;
  readonly args?: JsonValue;
  readonly live?: ToolLive;
  readonly result?: ToolResultView;
}

export interface NoteView {
  readonly commit: Oid;
  readonly at: number;
  readonly body: Extract<CommitBody, { kind: "note" }>;
}

export interface NotePresentation {
  readonly text: string;
}

export type ToolRefiner = (view: ToolView, base: ToolPresentation) => ToolPresentation;

export type NoteRefiner = (note: NoteView, base: NotePresentation) => NotePresentation | null;

export interface PresenterOptions {
  readonly tools?: Readonly<Record<string, ToolRefiner>>;
  readonly notes?: Readonly<Record<string, NoteRefiner>>;
}

export interface Presenter {
  tool(view: ToolView): ToolPresentation;
  note(note: NoteView): NotePresentation | null;
}

const DETAIL_ARGS = new Map([
  ["read", "path"],
  ["write", "path"],
  ["edit", "path"],
  ["ls", "path"],
  ["bash", "command"],
  ["task", "model"],
]);

const DETAIL_LIMIT = 80;

/**
 * What a run is doing while a stock tool is in flight. A status row reads
 * it, so the wording names the wait rather than the tool.
 */
const ACTIVITY = new Map([
  ["read", "Reading files"],
  ["ls", "Reading files"],
  ["bash", "Running shell command"],
  ["edit", "Editing files"],
  ["write", "Editing files"],
  ["task", "Waiting for subagent"],
  ["wait_task", "Waiting for subagent"],
  ["websearch", "Searching the web"],
]);

/**
 * Tools that hand work to a child session. `task` starts one; `wait_task`
 * joins one that a previous turn started. Both mean the same thing to a
 * reader, so both name the wait and neither belongs inside a work group.
 */
export type SubagentToolKind = "spawn" | "await";

const SUBAGENT_TOOLS = new Map<string, SubagentToolKind>([
  ["task", "spawn"],
  ["wait_task", "await"],
]);

export function subagentToolKind(name: string): SubagentToolKind | undefined {
  return SUBAGENT_TOOLS.get(name);
}

/**
 * The status for the tools currently running, oldest first. Subagent waits
 * win because they are the ones a reader wonders about; otherwise the newest
 * tool names the activity. Undefined for tools this table does not know.
 */
export function runActivityLabel(runningToolNames: readonly string[]): string | undefined {
  const newest = runningToolNames.at(-1);
  if (newest === undefined) return undefined;
  const subagents = runningToolNames.filter((name) => subagentToolKind(name) !== undefined).length;
  if (subagents > 1) return "Waiting for subagents";
  if (subagents === 1) return ACTIVITY.get("task");
  return ACTIVITY.get(newest);
}

function isNonEmptyString(value: JsonValue | undefined): value is string {
  return typeof value === "string" && value !== "";
}

function isPrimitiveSummaryValue(value: JsonValue): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function stringArg(args: JsonValue | undefined, key: string): string | undefined {
  if (!isJsonObject(args)) return undefined;
  const value = args[key];
  return isNonEmptyString(value) ? value : undefined;
}

function primitiveSummary(value: JsonValue | undefined): string | undefined {
  if (!isJsonObject(value)) return undefined;
  const pairs: string[] = [];
  for (const [key, field] of Object.entries(value)) {
    if (isPrimitiveSummaryValue(field)) {
      pairs.push(`${key}=${String(field)}`);
    }
  }
  if (pairs.length === 0) return undefined;
  const joined = pairs.join(" ");
  return joined.length <= DETAIL_LIMIT ? joined : `${joined.slice(0, DETAIL_LIMIT - 1)}…`;
}

function toolDetail(view: ToolView): string | undefined {
  const key = DETAIL_ARGS.get(view.toolName);
  if (key !== undefined) {
    const named = stringArg(view.args, key);
    if (named !== undefined) return named;
  }
  return primitiveSummary(view.args);
}

function textBody(text: string): ToolBody {
  return text.trim() === "" ? { kind: "none" } : { kind: "text", text };
}

export function projectToolView(part: ToolTurnPart, live?: ToolLive): ToolView {
  const base = {
    toolName: part.toolName,
    args: part.args,
  };
  const withLive = live === undefined ? base : { ...base, live };
  if (part.result === undefined) return withLive;

  const resultBase = {
    output: part.result.output,
    isError: part.result.isError,
  };
  const withDetails =
    part.result.details === undefined
      ? resultBase
      : { ...resultBase, details: part.result.details };
  const result =
    part.result.title === undefined ? withDetails : { ...withDetails, title: part.result.title };
  return { ...withLive, result };
}

export function presentTool(view: ToolView): ToolPresentation {
  const { result } = view;
  const title = result?.title ?? view.live?.title;
  const detail = toolDetail(view);
  const named = { name: view.toolName };
  const titled = title === undefined ? named : { ...named, title };
  const base = detail === undefined ? titled : { ...titled, detail };
  if (result === undefined) {
    return { ...base, status: "running", body: textBody(view.live?.text ?? "") };
  }
  if (result.isError) {
    return { ...base, status: "failed", body: textBody(result.output) };
  }
  const patch = readPatch(result.details);
  const facts = patch === undefined ? undefined : parsePatchFacts(patch);
  if (facts !== undefined && (facts.added > 0 || facts.removed > 0)) {
    // A multi-file patch has no single path for clients to apply to every hunk.
    const path = facts.files.length === 1 ? facts.files[0]?.path : undefined;
    const body: ToolBody =
      path === undefined ? { kind: "diff", ...facts } : { kind: "diff", ...facts, path };
    return {
      ...base,
      status: "done",
      body,
    };
  }
  return { ...base, status: "done", body: textBody(result.output) };
}

export function presentNote(note: {
  readonly commit: Oid;
  readonly at: number;
  readonly body: Extract<CommitBody, { kind: "note" }>;
}): NotePresentation {
  const summary = primitiveSummary(note.body.data);
  return { text: summary === undefined ? `[${note.body.type}]` : `[${note.body.type}] ${summary}` };
}

export function createPresenter(options: PresenterOptions = {}): Presenter {
  const tools = options.tools ?? {};
  const notes = options.notes ?? {};
  return {
    tool(view) {
      const base = presentTool(view);
      const refine = Object.hasOwn(tools, view.toolName) ? tools[view.toolName] : undefined;
      if (refine === undefined) return base;
      try {
        return refine(view, base);
      } catch {
        return base;
      }
    },
    note(note) {
      const base = presentNote(note);
      const refine = Object.hasOwn(notes, note.body.type) ? notes[note.body.type] : undefined;
      if (refine === undefined) return base;
      try {
        return refine(note, base);
      } catch {
        return base;
      }
    },
  };
}
