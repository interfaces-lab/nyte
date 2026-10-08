/**
 * Every row the transcript draws, as the SDK hands it over. A scene is a slice
 * of a session's state: `transcript` and `run` are `SessionSnapshot` fields,
 * `overlay` is the client fold's `LiveParts`, and `landing` is what
 * `conversationMessages` derives from `pending` and the outbox. Nothing here is
 * shaped for the renderer.
 */
import { sessionId } from "@nyte-ai/protocol";
import type {
  Failure,
  RunInfo,
  RunPhase,
  SessionId,
  SessionInfo,
  ToolReason,
  ToolState,
  ToolTurnPart,
  Turn,
  TurnPart,
  TurnToolClass,
  UserTurnPart,
} from "@nyte-ai/protocol";
import type { LiveParts } from "@nyte-ai/client";
import type { ProvisionalSubagentSession } from "@nyte-ai/app/conversation/subagent-sessions.ts";

export const CWD = "/Users/lab/nyte";

const T0 = Date.UTC(2026, 9, 7, 13, 30);

const RUN = "lab-run";

export interface Landing {
  readonly key: string;
  readonly content: UserTurnPart["content"];
  readonly pending: boolean;
}

export interface Scene {
  readonly transcript: readonly Turn[];
  readonly run?: RunInfo;
  readonly overlay?: LiveParts;
  readonly landing?: readonly Landing[];
  readonly loading?: true;
  readonly failed?: true;
}

export interface Specimen {
  readonly id: string;
  readonly title: string;
  /** The discriminants that pick this drawing. */
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

function user(content: UserTurnPart["content"], seconds = 0): UserTurnPart {
  return { kind: "user", commit: oid("user"), parent: null, content, at: at(seconds) };
}

function action(label: string, content: string, seconds = 0): UserTurnPart {
  return { ...user(content, seconds), source: { kind: "action", label } };
}

function said(text: string, seconds: number, contentIndex = 0): TurnPart {
  return { kind: "assistant", commit: oid("reply"), contentIndex, text, at: at(seconds) };
}

function thought(text: string, seconds: number, contentIndex = 0): TurnPart {
  return { kind: "thinking", commit: oid("reply"), contentIndex, text, at: at(seconds) };
}

function call(
  toolClass: TurnToolClass,
  state: ToolState,
  seconds: number,
  output?: string,
): ToolTurnPart {
  const part = {
    kind: "tool",
    callId: oid("call"),
    class: toolClass,
    state,
    at: at(seconds),
  } as const;

  return output === undefined ? part : { ...part, output };
}

function turn(
  parts: readonly TurnPart[],
  failure?: Failure,
): Extract<Turn, { readonly kind: "turn" }> {
  const first = parts[0]?.at ?? T0;
  const last = parts.at(-1)?.at ?? first;

  const base: Extract<Turn, { readonly kind: "turn" }> = {
    kind: "turn",
    id: oid("turn"),
    run: { kind: "run", id: RUN },
    parts: [...parts],
    startedAt: first,
    durationMs: last - first,
  };

  return failure === undefined ? base : { ...base, failure };
}

function run(phase: RunPhase, abortRequested?: true): RunInfo {
  const base = {
    runId: RUN,
    head: "main",
    origin: { kind: "user" },
    root: RUN,
    phase,
    startedAt: T0,
    attempts: 1,
    config: {},
  } as const;

  return abortRequested === undefined ? base : { ...base, abortRequested };
}

const ok = (): ToolState => ({ kind: "success", commit: oid("result") });

const failed = (reason: ToolReason): ToolState => ({
  kind: "error",
  reason,
  commit: oid("result"),
});

const PENDING: ToolState = { kind: "pending" };

const RUNNING: ToolState = { kind: "running" };

const NEEDS_INPUT: ToolState = {
  kind: "running",
  waitingFor: { kind: "input", waitId: "lab-wait" },
};

const INTERRUPTED: ToolState = { kind: "error", reason: { kind: "interrupted" }, commit: null };

const path = (relative: string): string => `${CWD}/${relative}`;

const read = (relative: string): TurnToolClass => ({ kind: "file_read", path: path(relative) });

const list = (relative: string): TurnToolClass => ({ kind: "list", path: path(relative) });

const shell = (
  command: string,
  extra: Pick<Extract<TurnToolClass, { readonly kind: "shell" }>, "description" | "facts"> = {},
): TurnToolClass => ({ kind: "shell", command, ...extra });

const custom = (label: string): TurnToolClass => ({ kind: "custom", label });

const lines = (...rows: readonly string[]): string => rows.join("\n");

const EDIT_PATCH = lines(
  "--- a/packages/app/src/conversation/step-group-content.ts",
  "+++ b/packages/app/src/conversation/step-group-content.ts",
  "@@ -16,7 +16,8 @@ export function stepGroupContent(input: {",
  '   if (input.open === true) return "open";',
  " ",
  '-  if (input.active && input.density === "compact") return input.hasContent ? "preview" : "closed";',
  '+  if (input.active && input.density === "compact")',
  '+    return input.hasContent ? "preview" : "closed";',
  " ",
  '   if (input.open === false) return "closed";',
  " ",
  '-  return input.active || (input.density === "detailed" && !input.thinkingOnly) ? "open" : "closed";',
  '+  return input.active || input.density === "detailed" ? "open" : "closed";',
  "",
);

const WRITE_PATCH = lines(
  "--- /dev/null",
  "+++ b/packages/lab/src/messages/notes.md",
  "@@ -0,0 +1,4 @@",
  "+# Messages",
  "+",
  "+Every row the transcript draws,",
  "+in every density.",
  "",
);

function smallPatch(file: string, before: string, after: string): string {
  return lines(`--- a/${file}`, `+++ b/${file}`, "@@ -1,1 +1,1 @@", `-${before}`, `+${after}`, "");
}

const edited: TurnToolClass = {
  kind: "file_patch",
  op: "edit",
  path: path("packages/app/src/conversation/step-group-content.ts"),
  added: 3,
  removed: 2,
  patch: EDIT_PATCH,
};

const created: TurnToolClass = {
  kind: "file_patch",
  op: "write",
  path: path("packages/lab/src/messages/notes.md"),
  added: 4,
  removed: 0,
  patch: WRITE_PATCH,
};

function touched(file: string): TurnToolClass {
  return {
    kind: "file_patch",
    op: "edit",
    path: path(file),
    added: 1,
    removed: 1,
    patch: smallPatch(file, "const density = useSetting(preferences.toolCalls);", "density,"),
  };
}

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

/** A 4:3 swatch, so an attachment draws without a network request. */
const SWATCH = btoa(
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c8cff"/><stop offset="1" stop-color="#ff9d7c"/></linearGradient></defs><rect width="160" height="120" fill="url(#g)"/></svg>',
);

/* ---------------------------------------------------------------- subagents */

function child(id: string, name: string, phase: RunPhase, awaitingReply?: true): SessionInfo {
  const session = sessionId(id);

  const headRun: RunInfo = {
    runId: `${id}-run`,
    head: "main",
    origin: { kind: "user" },
    root: `${id}-run`,
    phase,
    startedAt: T0,
    attempts: 1,
    config: {},
  };

  return {
    sessionId: session,
    activation: { kind: "active" },
    workspace: { kind: "local", id: "fixture", cwd: CWD },
    name,
    createdAt: T0,
    lastActivityAt: T0 + 60_000,
    pinned: false,
    archived: false,
    config: {},
    parent: { sessionId: sessionId("lab-messages"), runId: RUN, callId: id, depth: 1 },
    heads: [
      {
        head: "main",
        tip: null,
        run: awaitingReply === undefined ? headRun : { ...headRun, awaitingReply },
      },
    ],
  };
}

const starting: ProvisionalSubagentSession = {
  kind: "provisional",
  sessionId: sessionId("lab-agent-starting"),
  title: "Map translucent tints to tokens",
  startedAt: T0,
};

const finished = child("lab-agent-done", "Review titlebar alignment", { kind: "done" });

const asking = child("lab-agent-asking", "Confirm workspace trust copy", { kind: "waiting" }, true);

const broken = child("lab-agent-failed", "Audit floating surface shadows", {
  kind: "failed",
  failure: { class: "provider", message: "Model returned an empty response." },
});

/** Listed nowhere and read as absent: a create whose child never started. */
export const UNSTARTED = sessionId("lab-agent-unstarted");

export const SUBAGENTS: ReadonlyMap<SessionId, SessionInfo | ProvisionalSubagentSession> = new Map<
  SessionId,
  SessionInfo | ProvisionalSubagentSession
>([
  [starting.sessionId, starting],
  [finished.sessionId, finished],
  [asking.sessionId, asking],
  [broken.sessionId, broken],
]);

function create(title: string, session: SessionId, state: ToolState, seconds: number) {
  return call(
    { kind: "delegate", role: "create", title, target: { kind: "one", session } },
    state,
    seconds,
    `Started ${title}`,
  );
}

function delegate(
  role: "send" | "read" | "stop",
  session: SessionId,
  state: ToolState,
  seconds: number,
  output?: string,
) {
  return call({ kind: "delegate", role, target: { kind: "one", session } }, state, seconds, output);
}

/* ------------------------------------------------------------------ helpers */

/** One tool on its own: a settled lone call draws its own line, without a group. */
function lone(id: string, title: string, source: string, part: ToolTurnPart): Specimen {
  return { id, title, source, scene: { transcript: [turn([part])] } };
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
  "<TurnView turn={turn} density={density} liveTools={live.tools} running />",
  "```",
  "",
  "| Surface | Compact | Detailed |",
  "| --- | --- | --- |",
  "| Step group | preview while live | stays open |",
  "| Shell | verb line | card + tail |",
  "",
  "> A quote, for the blockquote style.",
);

/* ----------------------------------------------------------------- sections */

export const SECTIONS: readonly Section[] = [
  {
    id: "messages",
    title: "Messages",
    detail: "UserTurnPart and the assistant's text. Density changes none of these.",
    specimens: [
      {
        id: "user-text",
        title: "User message",
        source: 'part.kind = "user" · content: string',
        scene: { transcript: [turn([user(PROMPT)])] },
      },
      {
        id: "user-long",
        title: "Long user message",
        source: 'part.kind = "user" · clipped at 3.5 lines',
        scene: {
          transcript: [
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
        source: "content: (TextContent | ImageContent)[]",
        scene: {
          transcript: [
            turn([
              user([
                { type: "image", mimeType: "image/svg+xml", data: SWATCH },
                { type: "image", mimeType: "image/svg+xml", data: SWATCH },
                { type: "text", text: "Match these two swatches in the accent ramp." },
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
          transcript: [
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
          transcript: [
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
        source: 'part.kind = "assistant" · markdown',
        scene: { transcript: [turn([user(PROMPT), said(MARKDOWN, 8)])] },
      },
      {
        id: "assistant-parts",
        title: "Response in several parts",
        source: "consecutive assistant parts → one ResponseView",
        scene: {
          transcript: [
            turn([
              user(PROMPT),
              said("The settled summary now leads with the outcome.", 6, 0),
              said("Failed and stopped calls are tallied instead of claiming a verb.", 6, 1),
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
          transcript: [
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
          transcript: [
            turn([
              user(PROMPT),
              thought(
                "**Reading the presentation**\n\nThe summary counts files by set, so a file read twice counts once.",
                0,
                0,
              ),
              thought("**Checking failures**\n\nA failed call must not claim a verb.", 4, 1),
              said("Both rules already hold.", 7),
            ]),
          ],
        },
      },
      {
        id: "episode-edit",
        title: "Edited, explored and ran",
        source: "thinking · file_read · list · shell · file_patch",
        scene: {
          transcript: [
            turn([
              user(PROMPT),
              thought("**Finding the summary**\n\nThe verb is chosen in `settledSummary`.", 1, 0),
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
        source: "file_read × 2 · list",
        scene: {
          transcript: [
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
        source: "success + error(exit) · no verb claimed",
        scene: {
          transcript: [
            turn([
              user("Typecheck the lab."),
              call(read("packages/lab/src/router.tsx"), ok(), 1),
              call(
                shell("pnpm --dir packages/lab typecheck"),
                failed({ kind: "exit", code: 2 }),
                14,
                TYPE_ERRORS,
              ),
              said("Two call sites still need `density`.", 16),
            ]),
          ],
        },
      },
      {
        id: "episode-lost",
        title: "Every call failed or stopped",
        source: "error(error) · error(timeout) · error(cancelled)",
        scene: {
          transcript: [
            turn([
              user("Run the e2e suite."),
              call(shell("pnpm --dir packages/app e2e"), failed({ kind: "timeout" }), 1),
              call(
                custom("websearch"),
                failed({ kind: "error" }),
                2,
                "Search provider returned 503.",
              ),
              call(shell("pnpm --dir packages/desktop build"), failed({ kind: "cancelled" }), 3),
            ]),
          ],
        },
      },
      {
        id: "episode-split",
        title: "Prose between two episodes",
        source: "step · response · step · response",
        scene: {
          transcript: [
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
      "ToolTurnPart.class is typed per tool by the runner. ToolCallView switches on class.kind; shell and file edits have their own cards in detailed.",
    specimens: [
      lone(
        "tool-read",
        "Read a file",
        'class.kind = "file_read"',
        call(read("packages/app/src/live-fold.ts"), ok(), 0),
      ),
      lone(
        "tool-list",
        "List a directory",
        'class.kind = "list"',
        call(list("packages/client/src/views"), ok(), 0),
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
        "shell.description · shell.facts (duration, truncated)",
        call(
          shell("git log --oneline -200", {
            description: "show recent commits",
            facts: {
              durationMs: 4_200,
              truncated: true,
              fullOutputPath: "/tmp/nyte/output-1f3a.txt",
            },
          }),
          ok(),
          0,
          LOG_OUTPUT,
        ),
      ),
      lone(
        "tool-patch-edit",
        "Edited a file",
        'class.kind = "file_patch" · op = "edit"',
        call(edited, ok(), 0),
      ),
      lone(
        "tool-patch-write",
        "Created a file",
        'class.kind = "file_patch" · op = "write"',
        call(created, ok(), 0),
      ),
      lone(
        "tool-edit-running",
        "Editing (no result yet)",
        'class.kind = "file_edit" · state.kind = "running"',
        call(
          { kind: "file_edit", path: path("packages/app/src/conversation/turn-view.tsx") },
          RUNNING,
          0,
        ),
      ),
      lone(
        "tool-write-running",
        "Writing (no result yet)",
        'class.kind = "file_write" · state.kind = "running"',
        call({ kind: "file_write", path: path("packages/lab/src/messages/page.tsx") }, RUNNING, 0),
      ),
      lone(
        "tool-edit-denied",
        "Edit that was blocked",
        'class.kind = "file_edit" · error(denied) · falls back to the generic line',
        call(
          { kind: "file_edit", path: path(".env") },
          failed({ kind: "denied" }),
          0,
          "Writes outside the workspace's allowed paths are blocked.",
        ),
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
        'delegate · role = "create" · child provisional',
        create(starting.title, starting.sessionId, RUNNING, 0),
      ),
      lone(
        "agent-done",
        "Completed",
        'create · child run "done"',
        create("Review titlebar alignment", finished.sessionId, ok(), 0),
      ),
      lone(
        "agent-asking",
        "Waiting for a reply",
        'create · child "waiting" + awaitingReply',
        create("Confirm workspace trust copy", asking.sessionId, ok(), 0),
      ),
      lone(
        "agent-failed",
        "Failed",
        'create · child run "failed"',
        create("Audit floating surface shadows", broken.sessionId, ok(), 0),
      ),
      lone(
        "agent-unstarted",
        "Never started",
        "create · session reads null · status from the call",
        create("Profile the transcript", UNSTARTED, failed({ kind: "error" }), 0),
      ),
      lone(
        "agent-send",
        "Message to an agent",
        'delegate · role = "send"',
        delegate("send", finished.sessionId, ok(), 0, "Also check the window controls on Windows."),
      ),
      lone(
        "agent-read",
        "Read an agent",
        'delegate · role = "read"',
        delegate("read", finished.sessionId, ok(), 0),
      ),
      lone(
        "agent-stop",
        "Stop an agent",
        'delegate · role = "stop"',
        delegate("stop", asking.sessionId, ok(), 0),
      ),
    ],
  },
  {
    id: "states",
    title: "Tool states",
    detail:
      "ToolState is settled by the SDK, reasons included. toolStatus maps it to a tense, a tone and an outcome word.",
    specimens: [
      lone(
        "state-pending",
        "Pending",
        'state.kind = "pending"',
        call(shell("pnpm test"), PENDING, 0),
      ),
      lone(
        "state-running",
        "Running",
        'state.kind = "running"',
        call(shell("pnpm test"), RUNNING, 0),
      ),
      lone(
        "state-input",
        "Needs input",
        'running · waitingFor = { kind: "input" }',
        call(shell("pnpm test"), NEEDS_INPUT, 0),
      ),
      lone(
        "state-success",
        "Succeeded",
        'state.kind = "success"',
        call(shell("pnpm test"), ok(), 0, TEST_OUTPUT),
      ),
      lone(
        "state-exit",
        "Exited nonzero",
        'error · reason = { kind: "exit", code: 1 }',
        call(shell("pnpm test"), failed({ kind: "exit", code: 1 }), 0, TYPE_ERRORS),
      ),
      lone(
        "state-error",
        "Failed",
        'error · reason.kind = "error"',
        call(
          read("packages/lab/missing.ts"),
          failed({ kind: "error" }),
          0,
          "ENOENT: no such file or directory",
        ),
      ),
      lone(
        "state-timeout",
        "Timed out",
        'error · reason.kind = "timeout"',
        call(shell("pnpm --dir packages/app e2e"), failed({ kind: "timeout" }), 0),
      ),
      lone(
        "state-denied",
        "Blocked",
        'error · reason.kind = "denied"',
        call(shell("rm -rf node_modules"), failed({ kind: "denied" }), 0),
      ),
      lone(
        "state-cancelled",
        "Stopped",
        'error · reason.kind = "cancelled"',
        call(shell("pnpm build"), failed({ kind: "cancelled" }), 0),
      ),
      lone(
        "state-interrupted",
        "Interrupted",
        'error · reason.kind = "interrupted" · commit = null',
        call(read("packages/app/src/live.ts"), INTERRUPTED, 0),
      ),
    ],
  },
  {
    id: "outcomes",
    title: "Turn outcomes",
    detail:
      "Turn.failure carries why the assistant stopped; failureNotice words each class. Turns with settled file patches end in a changes card.",
    specimens: [
      {
        id: "failure-classes",
        title: "Every failure class",
        source: "Turn.failure.class × 9",
        scene: {
          transcript: (
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
              class: failureClass,
              message,
            }),
          ),
        },
      },
      {
        id: "changes-card",
        title: "Changes card",
        source: "file_patch success → changesFromTurns",
        scene: {
          transcript: [
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
          transcript: [
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
      "Turn kinds other than a conversation turn. Config draws nothing; a completion opens a requestless turn that rides under the previous prompt.",
    specimens: [
      {
        id: "checkpoint",
        title: "Context summarized",
        source: 'Turn.kind = "checkpoint"',
        scene: {
          transcript: [
            {
              kind: "checkpoint",
              commit: oid("checkpoint"),
              at: at(0),
              body: {
                kind: "checkpoint",
                summary:
                  "The user is moving tool call density from a global read to a prop. `TurnView` and `LiveTurn` take it; `Timeline` passes it. The lab call sites were updated.",
                retainedTail: [],
                tokensBefore: 182_000,
              },
            },
          ],
        },
      },
      {
        id: "summary",
        title: "Branch summary",
        source: 'Turn.kind = "summary"',
        scene: {
          transcript: [
            {
              kind: "summary",
              commit: oid("summary"),
              at: at(0),
              body: {
                kind: "summary",
                text: "On the abandoned branch the assistant tried a density context provider, then dropped it for a prop.",
              },
            },
          ],
        },
      },
      {
        id: "config",
        title: "Config change",
        source: 'Turn.kind = "config" · rendersInTranscript → false',
        scene: {
          transcript: [
            {
              kind: "config",
              commit: oid("config"),
              at: at(0),
              body: {
                kind: "config",
                model: { provider: "anthropic", id: "claude-opus" },
                thinkingLevel: "high",
              },
            },
          ],
        },
      },
      {
        id: "continuation",
        title: "Background report continues a turn",
        source: "turn without a user part → TranscriptRow.continuations",
        scene: {
          transcript: [
            turn([
              user("Run the e2e suite in the background and tell me when it's done."),
              call(
                shell("pnpm --dir packages/app e2e", { description: "run e2e in the background" }),
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
      "The trailing turn while a run is live, plus the overlay's streamed parts. The overlay is LiveParts from the client fold; the app reshapes it into LiveSnapshot first.",
    specimens: [
      {
        id: "live-waiting",
        title: "Working, nothing streamed yet",
        source: 'run.phase = "respond" · overlay = []',
        scene: { transcript: [turn([user(PROMPT)])], run: run({ kind: "respond" }), overlay: [] },
      },
      {
        id: "live-thinking",
        title: "Streaming reasoning",
        source: 'overlay: { kind: "thinking" }',
        scene: {
          transcript: [turn([user(PROMPT)])],
          run: run({ kind: "respond" }),
          overlay: [
            {
              kind: "thinking",
              runId: RUN,
              attempt: 1,
              index: 0,
              text: "**Reading the summary**\n\nThe verb comes from `settledSummary`. A failed call is tallied before",
            },
          ],
        },
      },
      {
        id: "live-text",
        title: "Streaming prose",
        source: 'overlay: { kind: "text" }',
        scene: {
          transcript: [
            turn([
              user(PROMPT),
              call(read("packages/app/src/conversation/step-group-presentation.ts"), ok(), 1),
            ]),
          ],
          run: run({ kind: "respond" }),
          overlay: [
            {
              kind: "text",
              runId: RUN,
              attempt: 1,
              index: 0,
              text: "The settled summary already leads with the outcome. What reads badly is the **trouble** case, where",
            },
          ],
        },
      },
      {
        id: "live-tool",
        title: "Running a tool with progress",
        source: 'run.phase = "tools" · overlay: { kind: "tool", progress }',
        scene: ((): Scene => {
          const running = call(shell("pnpm --dir packages/app test"), RUNNING, 3);

          return {
            transcript: [
              turn([
                user(PROMPT),
                thought("**Running the tests**\n\nThe step group tests cover every density.", 1),
                call(read("packages/app/src/conversation/step-group.tsx"), ok(), 2),
                running,
              ]),
            ],
            run: run({ kind: "tools" }),
            overlay: [
              {
                kind: "tool",
                runId: RUN,
                callId: running.callId,
                progress: {
                  text: lines(
                    " RUN  v4.1.0 /Users/lab/nyte/packages/app",
                    "",
                    " ✓ src/conversation/step-group-presentation.test.ts (9 tests) 4ms",
                    " ❯ src/conversation/step-group.test.ts 3/14",
                  ),
                },
              },
            ],
          };
        })(),
      },
      {
        id: "live-input",
        title: "Parked on a question",
        source: 'run.phase = "waiting" · tool waitingFor input',
        scene: {
          transcript: [
            turn([
              user("Delete the generated fixtures?"),
              call(custom("Ask user"), NEEDS_INPUT, 2),
            ]),
          ],
          run: run({ kind: "waiting" }),
        },
      },
      {
        id: "live-retry",
        title: "Retrying",
        source: 'run.phase = "retry"',
        scene: {
          transcript: [turn([user(PROMPT)])],
          run: run({
            kind: "retry",
            at: T0 + 30_000,
            retries: 1,
            failure: { class: "overloaded", message: "The model is temporarily unavailable." },
          }),
          overlay: [],
        },
      },
      {
        id: "live-stopping",
        title: "Stopping",
        source: "run.abortRequested = true",
        scene: {
          transcript: [turn([user(PROMPT), call(shell("pnpm build"), RUNNING, 2)])],
          run: run({ kind: "tools" }, true),
          overlay: [],
        },
      },
      {
        id: "landing-pending",
        title: "Sent while a run is live",
        source: "landing · pending = true (steers at the next boundary)",
        scene: {
          transcript: [
            turn([user(PROMPT), call(shell("pnpm --dir packages/app test"), RUNNING, 2)]),
          ],
          run: run({ kind: "tools" }),
          overlay: [],
          landing: [
            { key: "lab-landing-pending", content: "Also run the lab typecheck.", pending: true },
          ],
        },
      },
      {
        id: "landing-idle",
        title: "Sent, not landed yet",
        source: "landing · pending = false (outbox row, no commit)",
        scene: {
          transcript: [],
          landing: [{ key: "lab-landing", content: PROMPT, pending: false }],
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
        source: "snapshot.isLoading · no turns",
        scene: { transcript: [], loading: true },
      },
      {
        id: "row-error",
        title: "Couldn't load",
        source: "snapshot.isError",
        scene: { transcript: [], failed: true },
      },
    ],
  },
];
