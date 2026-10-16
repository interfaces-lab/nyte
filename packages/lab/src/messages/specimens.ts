import { lineDiff } from "@nyte-ai/core";
import { asId } from "@nyte-ai/schema";
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
import { isToolMessage } from "@nyte-ai/app/view-helpers.ts";
import type { ConversationTurn, UserMessage } from "@nyte-ai/app/view-helpers.ts";

export const CWD = "/Users/lab/nyte";

const T0 = Date.UTC(2026, 9, 7, 13, 30);

const RUN = asId<"run">("lab-run");

export interface Scene {
  readonly turns: readonly ConversationTurn[];
  readonly execution?: Execution;
  readonly landing?: readonly UserMessage[];
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

const LIVE: PartStatus = { kind: "live", run: RUN };

function user(content: UserContent, seconds = 0): UserMessage {
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

function action(label: string, content: string, seconds = 0): UserMessage {
  return { ...user(content, seconds), source: { kind: "action", label } };
}

function pending(content: string, schedule: Schedule): UserMessage {
  return { ...user(content), status: { kind: "pending", schedule, covered: true } };
}

function part(
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

const said = (markdown: string, seconds: number, status?: PartStatus): Message =>
  part("text", "answer", { markdown, signature: null }, seconds, status);

const thought = (markdown: string, seconds: number, status?: PartStatus): Message =>
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

function call(spec: ToolSpec, state: CallState, seconds: number, output?: string): Message {
  const id = oid("call");
  const base = { call: asId<"call">(spec.call ?? id), name: spec.name, args: spec.args, class: spec.class };

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

const WORKING: TurnInfo["state"] = { kind: "working", activity: null };

function turn(
  drafts: readonly Message[],
  state: TurnInfo["state"] = { kind: "ended", end: COMPLETED },
): ConversationTurn {
  const id = asId<"turn">(oid("turn"));
  const messages = drafts.map((message) => ({ ...message, turn: id }));
  const steps = messages.filter((message) => message.kind === "part" && message.role === "step");

  const tools = messages.flatMap((message) =>
    isToolMessage(message) && message.state.phase === "settled" ? [message.state] : [],
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

const RUN_VIEW: RunView = {
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

const responding = (stopping = false): Execution => ({
  kind: "live",
  run: RUN_VIEW,
  phase: "responding",
  stopping,
});

const executing = (stopping = false): Execution => ({
  kind: "live",
  run: RUN_VIEW,
  phase: "executing",
  stopping,
});

const ok = (): ToolOutcome => ({ kind: "ok", content: [], output: null, parts: [] });

const failed = (message: string): ToolOutcome => ({ kind: "failed", message });

const PENDING: CallState = { phase: "calling" };

const RUNNING: CallState = { phase: "running", progress: null };

const NEEDS_INPUT: CallState = { phase: "running", progress: null, waiting: true };

const INTERRUPTED: ToolOutcome = { kind: "interrupted" };

const BLOCKED: ToolOutcome = {
  kind: "rejected",
  reason: "Blocked by the workspace's tool policy.",
};

const STOPPED: ToolOutcome = { kind: "stopped" };

const path = (relative: string): string => `${CWD}/${relative}`;

const read = (relative: string): ToolSpec => ({
  name: "read",
  args: { path: path(relative) },
  class: { kind: "read", path: path(relative) },
});

const list = (relative: string): ToolSpec => ({
  name: "ls",
  args: { path: path(relative) },
  class: { kind: "list", path: path(relative) },
});

const shell = (command: string, description?: string, durationMs?: number): ToolSpec => ({
  name: "bash",
  args: { command },
  class:
    description === undefined
      ? { kind: "shell", command }
      : { kind: "shell", command, description },
  durationMs,
});

const custom = (label: string): ToolSpec => ({
  name: label,
  args: {},
  class: { kind: "custom", label },
});

const lines = (...rows: readonly string[]): string => rows.join("\n");

const filePatch = (
  file: string,
  status: "added" | "modified",
  before: string,
  after: string,
): PatchEntry => ({ path: file, status, digest: file, kind: "text", ...lineDiff(before, after) });

function editing(file: string, oldText: string, newText: string): ToolSpec {
  return {
    name: "edit",
    args: { path: path(file), edits: [{ oldText, newText }] },
    class: { kind: "edit", path: path(file) },
    changes: { added: newText.split("\n").length, removed: oldText.split("\n").length },
    patch: filePatch(path(file), "modified", oldText, newText),
  };
}

const edited = editing(
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

const created: ToolSpec = {
  name: "write",
  args: { path: path("packages/lab/src/messages/notes.md"), content: NOTES },
  class: { kind: "edit", path: path("packages/lab/src/messages/notes.md") },
  changes: { added: 4, removed: 0 },
  patch: filePatch(path("packages/lab/src/messages/notes.md"), "added", "", NOTES),
};

const touched = (file: string): ToolSpec =>
  editing(file, "const density = useSetting(preferences.toolCalls);", "density,");

const editSpec = (file: string): ToolSpec => ({
  name: "edit",
  args: { path: path(file) },
  class: { kind: "edit", path: path(file) },
});

const writeSpec = (file: string): ToolSpec => ({
  name: "write",
  args: { path: path(file) },
  class: { kind: "edit", path: path(file) },
});

const TEST_OUTPUT = lines(
  " RUN  v4.1.0 /Users/lab/nyte/packages/app",
  "",
  " ✓ src/conversation/step-group-presentation.test.ts (9 tests) 4ms",
  " ✓ src/conversation/step-group.test.ts (14 tests) 11ms",
  "",
  " Test Files  2 passed (2)",
  "      Tests  23 passed (23)",
  "   Duration  612ms",
);

const TYPE_ERRORS = lines(
  "src/canvas/turn.tsx(42,8): error TS2741: Property 'density' is missing in type '{ turn: … }'",
  "src/review/guide.tsx(190,14): error TS2741: Property 'density' is missing in type '{ turn: … }'",
  "",
  "Found 2 errors in 2 files.",
);

const RG_OUTPUT = lines(
  "packages/app/src/conversation/timeline.tsx:129:  const density = useSetting(preferences.toolCalls);",
  "packages/app/src/conversation/turn-view.tsx:583:  const toolCalls = useSetting(preferences.toolCalls);",
  "packages/app/src/conversation/live-turn.tsx:58:  const toolCalls = useSetting(preferences.toolCalls);",
);

const LOG_OUTPUT = lines(
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

const SWATCH = asId<"blob">("lab-swatch");


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

const finished = child("lab-agent-done", "Review titlebar alignment", {
  kind: "idle",
  lastRun: { id: RUN, end: COMPLETED, endedAt: T0 + 60_000 },
});

const asking = child("lab-agent-asking", "Confirm workspace trust copy", {
  kind: "waiting",
  run: RUN_VIEW,
  on: { kind: "part", part: asId<"part">("lab-agent-question") },
});

const broken = child("lab-agent-failed", "Audit floating surface shadows", {
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

function create(title: string, session: SessionInfo | null, state: CallState, seconds: number) {
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

function delegate(
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


function lone(id: string, title: string, source: string, message: Message): Specimen {
  return { id, title, source, scene: { turns: [turn([message])] } };
}

const PROMPT = "Tighten the step group copy so a settled episode reads in one line.";

const MARKDOWN = lines(
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


export const SECTIONS: readonly Section[] = [
  {
    id: "messages",
    title: "Messages",
    detail: "User messages and the assistant's text. Density changes none of these.",
    specimens: [
      {
        id: "user-text",
        title: "User message",
        source: 'kind = "user" · content: string',
        scene: { turns: [turn([user(PROMPT)])] },
      },
      {
        id: "user-long",
        title: "Long user message",
        source: 'kind = "user" · clipped at 3.5 lines',
        scene: {
          turns: [
            turn([
              user(
                lines(
                  "The step group summary should say what happened, not what the tools were called.",
                  "",
                  "When an episode edits one file, name the file. When it reads several, count them. A call that failed or stopped should never claim a verb: each tally says what became of it.",
                  "",
                  "Keep reasoning out of the summary unless it is the only thing in the group, and fold settled reasoning to its title in detailed mode.",
                  "",
                  "Then check every density: compact, balanced and detailed.",
                ),
              ),
            ]),
          ],
        },
      },
      {
        id: "user-images",
        title: "User message with images",
        source: "content: (text | file)[]",
        scene: {
          turns: [
            turn([
              user([
                { kind: "file", blob: SWATCH, mime: "image/svg+xml", name: "warm.svg" },
                { kind: "file", blob: SWATCH, mime: "image/svg+xml", name: "cool.svg" },
                { kind: "text", text: "Match these two swatches in the accent ramp." },
              ]),
            ]),
          ],
        },
      },
      {
        id: "user-references",
        title: "User message with references",
        source: "content: string · file URL and skill sentence",
        scene: {
          turns: [
            turn([
              user(
                `Use the unslop skill.\n\nRewrite the hint in @file://${CWD}/packages/app/src/settings/appearance.tsx so it fits one line.`,
              ),
            ]),
          ],
        },
      },
      {
        id: "user-action",
        title: "Action message",
        source: 'part.source = { kind: "action", label }',
        scene: {
          turns: [
            turn([
              action(
                "Review uncommitted changes",
                "Review the uncommitted changes in this workspace and report anything that would break the build.",
              ),
            ]),
          ],
        },
      },
      {
        id: "assistant-prose",
        title: "Assistant prose",
        source: 'partKind = "text" · markdown',
        scene: { turns: [turn([user(PROMPT), said(MARKDOWN, 8)])] },
      },
      {
        id: "assistant-parts",
        title: "Response in several parts",
        source: "consecutive text parts → one ResponseView",
        scene: {
          turns: [
            turn([
              user(PROMPT),
              said("The settled summary now leads with the outcome.", 6),
              said("Failed and stopped calls are tallied instead of claiming a verb.", 6),
            ]),
          ],
        },
      },
    ],
  },
  {
    id: "episodes",
    title: "Work episodes",
    detail:
      "Reasoning and tool calls between two pieces of prose form one StepGroupView. Density decides whether it opens.",
    specimens: [
      {
        id: "thought-titled",
        title: "One thought with a heading",
        source: 'thinking only · "**Heading**" titles the group',
        scene: {
          turns: [
            turn([
              user(PROMPT),
              thought(
                "**Weighing the grouping rule**\n\nPlacement has to follow `kind` alone. Anything that reads length or position moves prose under the reader when the next part lands.",
                0,
              ),
              said("Grouping stays keyed on kind.", 9),
            ]),
          ],
        },
      },
      {
        id: "thoughts",
        title: "Several thoughts",
        source: "thinking × 2",
        scene: {
          turns: [
            turn([
              user(PROMPT),
              thought(
                "**Reading the presentation**\n\nThe summary counts files by set, so a file read twice counts once.",
                0,
              ),
              thought("**Checking failures**\n\nA failed call must not claim a verb.", 4),
              said("Both rules already hold.", 7),
            ]),
          ],
        },
      },
      {
        id: "episode-edit",
        title: "Edited, explored and ran",
        source: "thinking · read · list · shell · edit",
        scene: {
          turns: [
            turn([
              user(PROMPT),
              thought("**Finding the summary**\n\nThe verb is chosen in `settledSummary`.", 1),
              call(list("packages/app/src/conversation"), ok(), 2),
              call(read("packages/app/src/conversation/step-group-presentation.ts"), ok(), 3),
              call(read("packages/app/src/conversation/step-group-content.ts"), ok(), 4),
              call(edited, ok(), 9),
              call(shell("pnpm --dir packages/app test step-group"), ok(), 21, TEST_OUTPUT),
              said("The compact preview now wraps instead of overflowing.", 24),
            ]),
          ],
        },
      },
      {
        id: "episode-explore",
        title: "Explored only",
        source: "read × 2 · list",
        scene: {
          turns: [
            turn([
              user("Where is tool call density read?"),
              call(list("packages/app/src/preferences"), ok(), 1),
              call(read("packages/app/src/preferences/index.ts"), ok(), 2),
              call(read("packages/app/src/conversation/timeline.tsx"), ok(), 3),
              said("`preferences.toolCalls`, read in `timeline.tsx`.", 5),
            ]),
          ],
        },
      },
      {
        id: "episode-trouble",
        title: "Episode with a failure",
        source: "ok + failed · no verb claimed",
        scene: {
          turns: [
            turn([
              user("Typecheck the lab."),
              call(read("packages/lab/src/router.tsx"), ok(), 1),
              call(shell("pnpm --dir packages/lab typecheck"), failed(TYPE_ERRORS), 14),
              said("Two call sites still need `density`.", 16),
            ]),
          ],
        },
      },
      {
        id: "episode-lost",
        title: "Every call failed or stopped",
        source: "failed × 2 · stopped",
        scene: {
          turns: [
            turn([
              user("Run the e2e suite."),
              call(shell("pnpm --dir packages/app e2e"), failed("Timed out after 120s."), 1),
              call(custom("websearch"), failed("Search provider returned 503."), 2),
              call(shell("pnpm --dir packages/desktop build"), STOPPED, 3),
            ]),
          ],
        },
      },
      {
        id: "episode-split",
        title: "Prose between two episodes",
        source: "step · response · step · response",
        scene: {
          turns: [
            turn([
              user(PROMPT),
              call(read("packages/app/src/conversation/turn-view.tsx"), ok(), 1),
              call(read("packages/app/src/conversation/live-turn.tsx"), ok(), 2),
              said("Both read the density themselves. Moving it to a prop.", 4),
              call(edited, ok(), 8),
              call(shell("pnpm --dir packages/app typecheck"), ok(), 30),
              said("Typecheck passes.", 31),
            ]),
          ],
        },
      },
    ],
  },
  {
    id: "tools",
    title: "Tool kinds",
    detail:
      "ToolPartState.class is typed per tool by the runner. ToolCallView switches on class.kind; shell and file edits have their own cards in detailed.",
    specimens: [
      lone(
        "tool-read",
        "Read a file",
        'class.kind = "read"',
        call(read("packages/app/src/live.ts"), ok(), 0),
      ),
      lone(
        "tool-list",
        "List a directory",
        'class.kind = "list"',
        call(list("packages/sdk/src"), ok(), 0),
      ),
      lone(
        "tool-shell",
        "Shell command",
        'class.kind = "shell"',
        call(
          shell('rg -n "useSetting\\(preferences.toolCalls\\)" packages/app/src'),
          ok(),
          0,
          RG_OUTPUT,
        ),
      ),
      lone(
        "tool-shell-described",
        "Shell with description and facts",
        "class.description · duration from status.endedAt",
        call(shell("git log --oneline -200", "show recent commits", 4_200), ok(), 0, LOG_OUTPUT),
      ),
      lone(
        "tool-patch-edit",
        "Edited a file",
        'class.kind = "edit" · name = "edit"',
        call(edited, ok(), 0),
      ),
      lone(
        "tool-patch-write",
        "Created a file",
        'class.kind = "edit" · name = "write"',
        call(created, ok(), 0),
      ),
      lone(
        "tool-edit-running",
        "Editing (no result yet)",
        'class.kind = "edit" · phase = "running"',
        call(editSpec("packages/app/src/conversation/turn-view.tsx"), RUNNING, 0),
      ),
      lone(
        "tool-write-running",
        "Writing (no result yet)",
        'class.kind = "edit" · name = "write" · phase = "running"',
        call(writeSpec("packages/lab/src/messages/page.tsx"), RUNNING, 0),
      ),
      lone(
        "tool-edit-denied",
        "Edit that was blocked",
        'class.kind = "edit" · outcome = "rejected"',
        call(editSpec(".env"), BLOCKED, 0),
      ),
      lone(
        "tool-custom-named",
        "Named tool",
        'class.kind = "custom" · label = "websearch"',
        call(
          custom("websearch"),
          ok(),
          0,
          "1. StyleX defineConsts — stylexjs.com/docs/api/javascript/defineConsts",
        ),
      ),
      lone(
        "tool-custom-browser",
        "Browser tool",
        'custom · label = "browser_snapshot"',
        call(custom("browser_snapshot"), ok(), 0, '- main\n  - heading "Chat messages" [level=1]'),
      ),
      lone(
        "tool-custom-search",
        "Tool search",
        'custom · label = "tool_search"',
        call(custom("tool_search"), ok(), 0),
      ),
      lone(
        "tool-custom-mcp",
        "MCP tool",
        'custom · label = "github: create_issue"',
        call(custom("github: create_issue"), ok(), 0, "Created issue #412"),
      ),
      lone(
        "tool-custom-mcp-name",
        "MCP tool by wire name",
        'custom · label = "mcp__linear__list_issues"',
        call(custom("mcp__linear__list_issues"), ok(), 0),
      ),
      lone(
        "tool-custom-phrase",
        "Tool labelled with a phrase",
        'custom · label = "Generate image"',
        call(custom("Generate image"), ok(), 0),
      ),
      lone(
        "tool-custom-plain",
        "Unknown tool",
        'custom · label = "fetch_metrics"',
        call(custom("fetch_metrics"), ok(), 0, '{ "p95": 412 }'),
      ),
    ],
  },
  {
    id: "agents",
    title: "Subagents",
    detail:
      "A delegate create is a card for its child session; send, read and stop on that child are lines. An await is the run's own control flow and never reaches a turn.",
    specimens: [
      lone(
        "agent-starting",
        "Starting",
        'delegate · role = "create" · no child yet · status from the call',
        create("Map translucent tints to tokens", null, RUNNING, 0),
      ),
      lone(
        "agent-done",
        "Completed",
        "create · child idle, last run completed",
        create("Review titlebar alignment", finished, ok(), 0),
      ),
      lone(
        "agent-asking",
        "Waiting for a reply",
        "create · child waiting on a part",
        create("Confirm workspace trust copy", asking, ok(), 0),
      ),
      lone(
        "agent-failed",
        "Failed",
        "create · child idle, last run failed",
        create("Audit floating surface shadows", broken, ok(), 0),
      ),
      lone(
        "agent-unstarted",
        "Never started",
        "create · no child · status from the call",
        create("Profile the transcript", null, failed("The subagent could not start."), 0),
      ),
      lone(
        "agent-send",
        "Message to an agent",
        'delegate · role = "send"',
        delegate("send", finished.id, ok(), 0, "Also check the window controls on Windows."),
      ),
      lone(
        "agent-read",
        "Read an agent",
        'delegate · role = "read"',
        delegate("read", finished.id, ok(), 0),
      ),
      lone(
        "agent-stop",
        "Stop an agent",
        'delegate · role = "stop"',
        delegate("stop", asking.id, ok(), 0),
      ),
    ],
  },
  {
    id: "states",
    title: "Tool states",
    detail:
      "ToolPartState carries the phase and outcome; the part status says when it waits. toolStatus maps it to a tense, a tone and an outcome word.",
    specimens: [
      lone("state-pending", "Pending", 'phase = "calling"', call(shell("pnpm test"), PENDING, 0)),
      lone("state-running", "Running", 'phase = "running"', call(shell("pnpm test"), RUNNING, 0)),
      lone(
        "state-input",
        "Needs input",
        "running · status = waiting on a part",
        call(shell("pnpm test"), NEEDS_INPUT, 0),
      ),
      lone(
        "state-success",
        "Succeeded",
        'outcome = "ok"',
        call(shell("pnpm test"), ok(), 0, TEST_OUTPUT),
      ),
      lone(
        "state-exit",
        "Exited nonzero",
        'outcome = "failed" · shell output',
        call(shell("pnpm test"), failed(TYPE_ERRORS), 0),
      ),
      lone(
        "state-error",
        "Failed",
        'outcome = "failed"',
        call(read("packages/lab/missing.ts"), failed("ENOENT: no such file or directory"), 0),
      ),
      lone(
        "state-denied",
        "Blocked",
        'outcome = "rejected"',
        call(shell("rm -rf node_modules"), BLOCKED, 0),
      ),
      lone(
        "state-cancelled",
        "Stopped",
        'outcome = "stopped"',
        call(shell("pnpm build"), STOPPED, 0),
      ),
      lone(
        "state-interrupted",
        "Interrupted",
        'outcome = "interrupted"',
        call(read("packages/app/src/live.ts"), INTERRUPTED, 0),
      ),
    ],
  },
  {
    id: "outcomes",
    title: "Turn outcomes",
    detail:
      "A turn that ended failed carries why the assistant stopped; failureNotice words each class. Turns with settled edits end in a changes card.",
    specimens: [
      {
        id: "failure-classes",
        title: "Every failure class",
        source: "TurnInfo.state.end.failure.class × 9",
        scene: {
          turns: (
            [
              ["aborted", "Aborted by the user."],
              ["rate_limit", "429"],
              ["context_window", "prompt is too long"],
              ["quota", "insufficient_quota"],
              ["auth", "401"],
              ["overloaded", "529"],
              ["network", "ECONNRESET"],
              ["provider", "The provider closed the stream before the response completed."],
              ["runner", "The tool batch exceeded its step ceiling."],
            ] as const
          ).map(([failureClass, message], index) =>
            turn([said(`Response ${String(index + 1)} started…`, index)], {
              kind: "ended",
              end: { kind: "failed", failure: { class: failureClass, message } },
            }),
          ),
        },
      },
      {
        id: "changes-card",
        title: "Changes card",
        source: "settled edit changes → TurnChangesCard",
        scene: {
          turns: [
            turn([
              user(PROMPT),
              call(edited, ok(), 4),
              call(created, ok(), 9),
              said("Two files changed.", 11),
            ]),
          ],
        },
      },
      {
        id: "changes-many",
        title: "Changes card, more than five files",
        source: "changes > CHANGES_VISIBLE_FILES",
        scene: {
          turns: [
            turn([
              user("Thread density through every TurnView caller."),
              ...[
                "packages/app/src/conversation/turn-view.tsx",
                "packages/app/src/conversation/live-turn.tsx",
                "packages/app/src/conversation/timeline.tsx",
                "packages/lab/src/canvas/turn.tsx",
                "packages/lab/src/review/guide.tsx",
                "packages/lab/src/review/side-chat.tsx",
                "packages/app/src/conversation/subagent-call.test.tsx",
              ].map((file, index) => call(touched(file), ok(), index + 1)),
              said("Every caller passes `density`.", 9),
            ]),
          ],
        },
      },
    ],
  },
  {
    id: "history",
    title: "History",
    detail:
      "Notes between turns, and a requestless turn: a background report opens a turn that rides under the previous prompt.",
    specimens: [
      {
        id: "compaction",
        title: "Context summarized",
        source: 'partKind = "compaction" · role = "note"',
        scene: {
          turns: [
            turn([
              part(
                "compaction",
                "note",
                {
                  summary:
                    "The user is moving tool call density from a global read to a prop. `TurnView` and `LiveTurn` take it; `Timeline` passes it. The lab call sites were updated.",
                  material: null,
                  tokensBefore: 182_000,
                  usage: null,
                },
                0,
              ),
            ]),
          ],
        },
      },
      {
        id: "branch-summary",
        title: "Branch summary",
        source: 'partKind = "branchSummary" · role = "note"',
        scene: {
          turns: [
            turn([
              part(
                "branchSummary",
                "note",
                {
                  markdown:
                    "On the abandoned branch the assistant tried a density context provider, then dropped it for a prop.",
                },
                0,
              ),
            ]),
          ],
        },
      },
      {
        id: "continuation",
        title: "Background report continues a turn",
        source: "TurnInfo.prompt = null → TranscriptRow.continuations",
        scene: {
          turns: [
            turn([
              user("Run the e2e suite in the background and tell me when it's done."),
              call(
                shell("pnpm --dir packages/app e2e", "run e2e in the background"),
                ok(),
                2,
                "Started job e2e-41",
              ),
              said("Started. I'll report back when it finishes.", 3),
            ]),
            turn([]),
            turn([said("The e2e suite finished: 48 passed, 0 failed.", 240)]),
          ],
        },
      },
    ],
  },
  {
    id: "live",
    title: "Run in flight",
    detail:
      "The trailing turn while a run is live. Streaming parts are messages with status live; the view carries them like any other.",
    specimens: [
      {
        id: "live-waiting",
        title: "Working, nothing streamed yet",
        source: 'execution = live · phase = "responding"',
        scene: { turns: [turn([user(PROMPT)], WORKING)], execution: responding() },
      },
      {
        id: "live-thinking",
        title: "Streaming reasoning",
        source: 'thinking · status = "live"',
        scene: {
          turns: [
            turn(
              [
                user(PROMPT),
                thought(
                  "**Reading the summary**\n\nThe verb comes from `settledSummary`. A failed call is tallied before",
                  1,
                  LIVE,
                ),
              ],
              WORKING,
            ),
          ],
          execution: responding(),
        },
      },
      {
        id: "live-text",
        title: "Streaming prose",
        source: 'text · status = "live"',
        scene: {
          turns: [
            turn(
              [
                user(PROMPT),
                call(read("packages/app/src/conversation/step-group-presentation.ts"), ok(), 1),
                said(
                  "The settled summary already leads with the outcome. What reads badly is the **trouble** case, where",
                  2,
                  LIVE,
                ),
              ],
              WORKING,
            ),
          ],
          execution: responding(),
        },
      },
      {
        id: "live-tool",
        title: "Running a tool with progress",
        source: 'phase = "executing" · tool phase = "running" · progress',
        scene: {
          turns: [
            turn(
              [
                user(PROMPT),
                thought("**Running the tests**\n\nThe step group tests cover every density.", 1),
                call(read("packages/app/src/conversation/step-group.tsx"), ok(), 2),
                call(
                  shell("pnpm --dir packages/app test"),
                  {
                    phase: "running",
                    progress: lines(
                      " RUN  v4.1.0 /Users/lab/nyte/packages/app",
                      "",
                      " ✓ src/conversation/step-group-presentation.test.ts (9 tests) 4ms",
                      " ❯ src/conversation/step-group.test.ts 3/14",
                    ),
                  },
                  3,
                ),
              ],
              { kind: "working", activity: "Running" },
            ),
          ],
          execution: executing(),
        },
      },
      {
        id: "live-input",
        title: "Parked on a question",
        source: 'execution = waiting · on = { kind: "part" }',
        scene: {
          turns: [
            turn(
              [user("Delete the generated fixtures?"), call(custom("Ask user"), NEEDS_INPUT, 2)],
              WORKING,
            ),
          ],
          execution: {
            kind: "waiting",
            run: RUN_VIEW,
            on: { kind: "part", part: asId<"part">("lab-question") },
          },
        },
      },
      {
        id: "live-retry",
        title: "Retrying",
        source: "execution = retrying",
        scene: {
          turns: [turn([user(PROMPT)], WORKING)],
          execution: {
            kind: "retrying",
            run: RUN_VIEW,
            until: T0 + 30_000,
            reason: "The model is temporarily unavailable.",
          },
        },
      },
      {
        id: "live-stopping",
        title: "Stopping",
        source: "execution.stopping = true",
        scene: {
          turns: [turn([user(PROMPT), call(shell("pnpm build"), RUNNING, 2)], WORKING)],
          execution: executing(true),
        },
      },
      {
        id: "landing-pending",
        title: "Sent while a run is live",
        source: 'landing · status = pending · schedule = "joined"',
        scene: {
          turns: [
            turn([user(PROMPT), call(shell("pnpm --dir packages/app test"), RUNNING, 2)], WORKING),
          ],
          execution: executing(),
          landing: [pending("Also run the lab typecheck.", { kind: "joined", run: RUN })],
        },
      },
      {
        id: "landing-idle",
        title: "Sent, not landed yet",
        source: "landing · status = pending · no turn yet",
        scene: {
          turns: [],
          landing: [pending(PROMPT, { kind: "next-turn", reason: "idle" })],
        },
      },
    ],
  },
  {
    id: "rows",
    title: "Transcript states",
    detail: "Rows that stand in for the transcript itself.",
    specimens: [
      {
        id: "row-loading",
        title: "Loading",
        source: "view = undefined · no turns",
        scene: { turns: [], loading: true },
      },
      {
        id: "row-error",
        title: "Couldn't load",
        source: "failed",
        scene: { turns: [], failed: true },
      },
    ],
  },
];
