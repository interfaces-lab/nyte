/** Builders for the message specimens: messages, tool calls, turns and runs at fixed times. */
import { lineDiff } from "@nyte-ai/core";
import { asId, writePatch } from "@nyte-ai/schema";
import type {
  Execution,
  Json,
  Message,
  PartStatus,
  PatchEntry,
  RunEnd,
  RunView,
  Schedule,
  SessionId,
  SessionInfo,
  ToolClass,
  ToolOutcome,
  ToolPartState,
  TurnInfo,
  UserContent,
} from "@nyte-ai/sdk";
import type { TurnMessages } from "@nyte-ai/app/view-helpers.ts";
import { showsTool, type UserMessage } from "@nyte-ai/plugin/client/presentation";

export const CWD = "/Users/lab/nyte";

export const T0 = Date.UTC(2026, 9, 7, 13, 30);

export const RUN = asId<"run">("lab-run");

export interface Scene {
  readonly turns: readonly TurnMessages[];
  readonly execution?: Execution;
  readonly prompts?: readonly UserMessage[];
  readonly loading?: true;
  readonly failed?: true;
}

export interface Specimen {
  readonly id: string;
  readonly title: string;
  readonly source: string;
  readonly scene: Scene;
}

export interface Section {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly specimens: readonly Specimen[];
}

let counter = 0;

function oid(label: string): string {
  counter += 1;

  return `${label}-${String(counter)}`;
}

const at = (seconds: number): number => T0 + seconds * 1_000;

const NO_TURN = asId<"turn">("");

const settled = (seconds: number): PartStatus => ({
  kind: "settled",
  commit: asId<"commit">(oid("commit")),
  endedAt: at(seconds),
});

export const LIVE: PartStatus = { kind: "live", run: RUN };

export function user(content: UserContent, seconds = 0): UserMessage {
  return {
    kind: "user",
    id: asId<"message">(oid("user")),
    turn: NO_TURN,
    at: at(seconds),
    content,
    source: { kind: "user" },
    delivery: "queue",
    status: { kind: "landed", commit: asId<"commit">(oid("commit")), run: RUN, replaced: null },
    siblings: { index: 0, count: 1, ids: [] },
  };
}

export function action(label: string, content: string, seconds = 0): UserMessage {
  return { ...user(content, seconds), source: { kind: "action", label } };
}

export function pending(content: string, schedule: Schedule): UserMessage {
  return { ...user(content), status: { kind: "pending", schedule, covered: true } };
}

export function part(
  partKind: string,
  role: "step" | "answer" | "note",
  state: Json,
  seconds: number,
  status: PartStatus = settled(seconds),
): Message {
  const id = oid(partKind);

  return {
    kind: "part",
    id: asId<"message">(id),
    turn: NO_TURN,
    at: at(seconds),
    part: asId<"part">(id),
    partKind,
    role,
    state,
    version: 1,
    status,
  };
}

export const said = (markdown: string, seconds: number, status?: PartStatus): Message =>
  part("text", "answer", { markdown, signature: null }, seconds, status);

export const thought = (markdown: string, seconds: number, status?: PartStatus): Message =>
  part("thinking", "step", { markdown, merged: 1, signature: null }, seconds, status);

interface ToolSpec {
  readonly call?: string;
  readonly name: string;
  readonly args: Json;
  readonly class: ToolClass;
  readonly changes?: { readonly added: number; readonly removed: number };
  readonly patch?: PatchEntry;
  readonly durationMs?: number;
}

type CallState =
  | { readonly phase: "calling" }
  | { readonly phase: "running"; readonly progress: string | null; readonly waiting?: true }
  | ToolOutcome;

export function call(spec: ToolSpec, state: CallState, seconds: number, output?: string): Message {
  const id = oid("call");
  const base = {
    call: asId<"call">(spec.call ?? id),
    name: spec.name,
    args: spec.args,
    class: spec.class,
  };

  const toolState: ToolPartState =
    "phase" in state
      ? state.phase === "calling"
        ? { ...base, phase: "calling" }
        : {
            ...base,
            phase: "running",
            progress: state.progress === null ? null : { text: state.progress },
          }
      : {
          ...base,
          phase: "settled",
          outcome:
            state.kind === "ok"
              ? {
                  ...state,
                  ...(output === undefined ? {} : { content: [{ kind: "text", text: output }] }),
                  output: spec.patch ?? state.output,
                }
              : state,
          changes:
            spec.changes === undefined || state.kind !== "ok"
              ? null
              : { ...spec.changes, paths: [spec.class.kind === "edit" ? spec.class.path : ""] },
        };

  const status: PartStatus =
    "phase" in state
      ? state.phase === "running" && state.waiting === true
        ? {
            kind: "waiting",
            run: RUN,
            on: { kind: "part", part: asId<"part">(`${id}-question`) },
          }
        : LIVE
      : {
          kind: "settled",
          commit: asId<"commit">(oid("commit")),
          endedAt: at(seconds) + (spec.durationMs ?? 0),
        };

  return {
    kind: "part",
    id: asId<"message">(id),
    turn: NO_TURN,
    at: at(seconds),
    part: asId<"part">(id),
    partKind: "tool",
    role: "step",
    state: toolState,
    version: 1,
    status,
  };
}

const COMPLETED: RunEnd = {
  kind: "completed",
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: null,
    total: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
};

export const WORKING: TurnInfo["state"] = { kind: "working", activity: null };

export function turn(
  drafts: readonly Message[],
  state: TurnInfo["state"] = { kind: "ended", end: COMPLETED },
): TurnMessages {
  const id = asId<"turn">(oid("turn"));
  const messages = drafts.map((message) => ({ ...message, turn: id }));
  const steps = messages.filter((message) => message.kind === "part" && message.role === "step");

  const tools = messages.flatMap((message) =>
    showsTool(message) && message.state.phase === "settled" ? [message.state] : [],
  );

  const succeeded = tools.filter((tool) => tool.outcome.kind === "ok");
  const first = messages[0]?.at ?? T0;

  const tally = (kind: ToolClass["kind"]) => {
    const calls = succeeded.filter((tool) => tool.class.kind === kind);

    return {
      count: calls.length,
      paths: calls.flatMap((tool) => tool.changes?.paths ?? []),
    };
  };

  const byClass = {
    read: tally("read"),
    list: tally("list"),
    edit: tally("edit"),
    shell: tally("shell"),
    delegate: tally("delegate"),
    custom: tally("custom"),
  } satisfies TurnInfo["summary"]["byClass"];

  const info: TurnInfo = {
    id,
    run: RUN,
    prompt: messages.find((message) => message.kind === "user")?.id ?? null,
    state,
    startedAt: first,
    endedAt: state.kind === "ended" ? (messages.at(-1)?.at ?? first) : null,
    steps: steps.length,
    thinkingOnly:
      steps.length > 0 &&
      steps.every((message) => message.kind === "part" && message.partKind === "thinking"),
    summary: {
      byClass,
      failed: tools.filter((tool) => tool.outcome.kind === "failed").length,
      stopped: tools.filter((tool) => tool.outcome.kind === "stopped").length,
      added: tools.reduce((sum, tool) => sum + (tool.changes?.added ?? 0), 0),
      removed: tools.reduce((sum, tool) => sum + (tool.changes?.removed ?? 0), 0),
    },
  };

  return { info, messages };
}

export const RUN_VIEW: RunView = {
  id: RUN,
  head: asId<"head">("main"),
  startedAt: T0,
  attempt: 1,
  configuration: {
    kind: "exact",
    model: { provider: "anthropic", id: "claude-opus" },
    thinking: "high",
    agent: null,
    settings: {},
    settingsVersion: "lab",
  },
  origin: { kind: "input", message: asId<"message">("lab-prompt") },
};

export const responding = (stopping = false): Execution => ({
  kind: "live",
  run: RUN_VIEW,
  phase: "responding",
  stopping,
});

export const executing = (stopping = false): Execution => ({
  kind: "live",
  run: RUN_VIEW,
  phase: "executing",
  stopping,
});

export const ok = (): ToolOutcome => ({ kind: "ok", content: [], output: null, parts: [] });

export const failed = (message: string): ToolOutcome => ({ kind: "failed", message });

export const PENDING: CallState = { phase: "calling" };

export const RUNNING: CallState = { phase: "running", progress: null };

export const NEEDS_INPUT: CallState = { phase: "running", progress: null, waiting: true };

export const INTERRUPTED: ToolOutcome = { kind: "interrupted" };

export const BLOCKED: ToolOutcome = {
  kind: "rejected",
  reason: "Blocked by the workspace's tool policy.",
};

export const STOPPED: ToolOutcome = { kind: "stopped" };

const path = (relative: string): string => `${CWD}/${relative}`;

export const read = (relative: string): ToolSpec => ({
  name: "read",
  args: { path: path(relative) },
  class: { kind: "read", path: path(relative) },
});

export const list = (relative: string): ToolSpec => ({
  name: "ls",
  args: { path: path(relative) },
  class: { kind: "list", path: path(relative) },
});

export const shell = (command: string, description?: string, durationMs?: number): ToolSpec => ({
  name: "bash",
  args: { command },
  class:
    description === undefined
      ? { kind: "shell", command }
      : { kind: "shell", command, description },
  durationMs,
});

export const custom = (label: string): ToolSpec => ({
  name: label,
  args: {},
  class: { kind: "custom", label },
});

export const lines = (...rows: readonly string[]): string => rows.join("\n");

const filePatch = (
  file: string,
  status: "added" | "modified",
  before: string,
  after: string,
): PatchEntry => {
  const { hunks, added, removed } = lineDiff(before, after);

  return {
    path: file,
    status,
    digest: file,
    kind: "text",
    added,
    removed,
    patch: writePatch(file, status, hunks),
  };
};

function editing(file: string, oldText: string, newText: string): ToolSpec {
  return {
    name: "edit",
    args: { path: path(file), edits: [{ oldText, newText }] },
    class: { kind: "edit", path: path(file) },
    changes: { added: newText.split("\n").length, removed: oldText.split("\n").length },
    patch: filePatch(path(file), "modified", oldText, newText),
  };
}

export const edited = editing(
  "packages/app/src/conversation/step-group-content.ts",
  lines(
    '  if (input.active && input.density === "compact") return input.hasContent ? "preview" : "closed";',
    '  return input.active || (input.density === "detailed" && !input.thinkingOnly) ? "open" : "closed";',
  ),
  lines(
    '  if (input.active && input.density === "compact")',
    '    return input.hasContent ? "preview" : "closed";',
    '  return input.active || input.density === "detailed" ? "open" : "closed";',
  ),
);

const NOTES = lines("# Messages", "", "Every row the transcript draws,", "in every density.");

export const created: ToolSpec = {
  name: "write",
  args: { path: path("packages/lab/src/messages/notes.md"), content: NOTES },
  class: { kind: "edit", path: path("packages/lab/src/messages/notes.md") },
  changes: { added: 4, removed: 0 },
  patch: filePatch(path("packages/lab/src/messages/notes.md"), "added", "", NOTES),
};

export const touched = (file: string): ToolSpec =>
  editing(file, "const density = useSetting(preferences.toolCalls);", "density,");

export const editSpec = (file: string): ToolSpec => ({
  name: "edit",
  args: { path: path(file) },
  class: { kind: "edit", path: path(file) },
});

export const writeSpec = (file: string): ToolSpec => ({
  name: "write",
  args: { path: path(file) },
  class: { kind: "edit", path: path(file) },
});

export const TEST_OUTPUT = lines(
  " RUN  v4.1.0 /Users/lab/nyte/packages/app",
  "",
  " ✓ src/conversation/step-group-presentation.test.ts (9 tests) 4ms",
  " ✓ src/conversation/step-group.test.ts (14 tests) 11ms",
  "",
  " Test Files  2 passed (2)",
  "      Tests  23 passed (23)",
  "   Duration  612ms",
);

export const TYPE_ERRORS = lines(
  "src/canvas/turn.tsx(42,8): error TS2741: Property 'density' is missing in type '{ turn: … }'",
  "src/review/guide.tsx(190,14): error TS2741: Property 'density' is missing in type '{ turn: … }'",
  "",
  "Found 2 errors in 2 files.",
);

export const RG_OUTPUT = lines(
  "packages/app/src/conversation/timeline.tsx:129:  const density = useSetting(preferences.toolCalls);",
  "packages/app/src/conversation/turn-view.tsx:583:  const toolCalls = useSetting(preferences.toolCalls);",
  "packages/app/src/conversation/live-turn.tsx:58:  const toolCalls = useSetting(preferences.toolCalls);",
);

export const LOG_OUTPUT = lines(
  "dfd833df feat(core)!: sessions reload their own plugins from the trust answer",
  "9be7ca88 feat: make the integrated browser work for everyday dev flows",
  "92b65059 feat: ask folder trust only where a folder carries project input",
  "b4ccd540 fix(app): round the scroll-to-bottom button",
  "d3547ed9 feat: show chat cost, context and branch in the workbench rail",
  "8a231551 feat(lab): add chat rail mocks",
  "acebe344 fix(lab): expand StyleX border shorthands in the changes mocks",
  "8d381809 fix(app): count workbench changes from the uncommitted diff",
  "80a2f475 refactor(docs): own docs navigation and layout on Fumadocs primitives",
  "450e3244 chore: release 0.0.16-dev.4",
  "7ad7868c build(desktop): raise renderer startup budget to 4,700 KiB",
  "1cf97733 perf(app): keep TypeBox template parser out of the font schema",
);

export const SWATCH = asId<"blob">("lab-swatch");

function child(id: string, name: string, execution: Execution): SessionInfo {
  return {
    id: asId<"session">(id),
    name,
    parent: asId<"session">("lab-messages"),
    call: asId<"call">(`${id}-create`),
    workspace: asId<"workspace">("fixture"),
    pinned: false,
    archived: false,
    activation: { kind: "active" },
    heads: [
      { name: asId<"head">("main"), tip: { kind: "start" }, stack: null, execution, unread: false },
    ],
    createdAt: T0,
    lastActivityAt: T0 + 60_000,
  };
}

export const finished = child("lab-agent-done", "Review titlebar alignment", {
  kind: "idle",
  lastRun: { id: RUN, end: COMPLETED, endedAt: T0 + 60_000 },
});

export const asking = child("lab-agent-asking", "Confirm workspace trust copy", {
  kind: "waiting",
  run: RUN_VIEW,
  on: { kind: "part", part: asId<"part">("lab-agent-question") },
});

export const broken = child("lab-agent-failed", "Audit floating surface shadows", {
  kind: "idle",
  lastRun: {
    id: RUN,
    end: {
      kind: "failed",
      failure: { class: "provider", message: "Model returned an empty response." },
    },
    endedAt: T0 + 60_000,
  },
});

export const SUBAGENTS: readonly SessionInfo[] = [finished, asking, broken];

export function create(
  title: string,
  session: SessionInfo | null,
  state: CallState,
  seconds: number,
) {
  return call(
    {
      call: session?.call ?? oid("call"),
      name: "task",
      args: { title },
      class: { kind: "delegate", child: session?.id ?? null, role: "create", title },
    },
    state,
    seconds,
    `Started ${title}`,
  );
}

export function delegate(
  role: "send" | "read" | "stop",
  session: SessionId,
  state: CallState,
  seconds: number,
  output?: string,
) {
  return call(
    { name: role, args: {}, class: { kind: "delegate", child: session, role, title: null } },
    state,
    seconds,
    output,
  );
}

export function lone(id: string, title: string, source: string, message: Message): Specimen {
  return { id, title, source, scene: { turns: [turn([message])] } };
}

export const PROMPT = "Tighten the step group copy so a settled episode reads in one line.";

export const MARKDOWN = lines(
  "The density is read in three places, so a column cannot pick its own:",
  "",
  "1. `Timeline` reads it for row estimates.",
  "2. `TurnBody` reads it again for each step group.",
  "3. `LiveTurn` reads it a third time.",
  "",
  "### What changed",
  "",
  "`TurnView` and `LiveTurn` now take `density` as a prop; `Timeline` stays the only reader.",
  "",
  "```ts",
  "<TurnView turn={turn} density={density} running />",
  "```",
  "",
  "| Surface | Compact | Detailed |",
  "| --- | --- | --- |",
  "| Step group | preview while live | stays open |",
  "| Shell | verb line | card + tail |",
  "",
  "> A quote, for the blockquote style.",
);
