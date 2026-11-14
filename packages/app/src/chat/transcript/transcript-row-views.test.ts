import { expect, test } from "vitest";
import type { Message, MessageSource, PartStatus } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import type { Json } from "@nyte-ai/schema";
import type { TextMessage, UserMessage } from "@nyte-ai/plugin/client/presentation";
import { settledTool } from "../../../test/view-fixtures.ts";
import { responseRowView, shownRow, stepRowView, userRowView } from "./transcript-row-views.ts";
import type { StepMessage } from "./transcript-presentation.ts";
import type { PromptRow, TranscriptRow, TurnItemRow } from "./transcript-rows.ts";

const LAYOUT = { key: "row", group: null, leads: true, sticky: false } as const;

const LIVE: PartStatus = { kind: "live", run: asId<"run">("run") };

const read = (id: string) => settledTool(id, { kind: "read", path: "src/a.ts" });

function named(id: string, name: string, args: Json): StepMessage {
  const message = settledTool(id, { kind: "custom", label: name });

  return { ...message, state: { ...message.state, name, args } };
}

function running(message: StepMessage): StepMessage {
  return { ...message, status: LIVE };
}

function thought(id: string, markdown: string): StepMessage {
  return {
    id: asId<"message">(id),
    turn: asId<"turn">("t"),
    at: 1,
    kind: "part",
    part: asId<"part">(id),
    partKind: "thinking",
    role: "step",
    version: 1,
    state: { markdown, merged: 1, signature: null },
    status: { kind: "settled", commit: asId<"commit">(id), endedAt: 2 },
  };
}

function step(messages: readonly StepMessage[], isRunning: boolean) {
  return { ...LAYOUT, kind: "step", messages, added: 0, removed: 0, running: isRunning } as const;
}

test.each<[string, readonly StepMessage[], boolean, "entry" | "group", string | undefined]>([
  ["a settled single tool draws its entry alone", [read("a")], false, "entry", "tool"],
  ["a settled single thought stays a group", [thought("a", "Thinking")], false, "group", undefined],
  ["a running single tool stays a group", [running(read("a"))], true, "group", undefined],
  [
    "a step row still running with a settled single tool stays a group",
    [read("a")],
    true,
    "group",
    undefined,
  ],
  [
    "browser steps merge into one entry",
    [
      named("a", "browser_open", { url: "https://a.test" }),
      named("b", "browser_click", { ref: "e1" }),
    ],
    false,
    "entry",
    "browser",
  ],
  [
    "a script hides the calls it nested",
    [
      named("s", "codemode", null),
      { ...read("n"), state: { ...read("n").state, call: asId<"call">("s:1") } },
    ],
    false,
    "entry",
    "tool",
  ],
  [
    "a blank thought beside one tool leaves the tool alone",
    [thought("a", "  "), read("b")],
    false,
    "entry",
    "tool",
  ],
  ["two tools stay a group", [read("a"), read("b")], false, "group", undefined],
  ["an empty step is a group", [], false, "group", undefined],
])("%s", (_, messages, isRunning, kind, entry) => {
  const view = stepRowView(step(messages, isRunning));

  expect(view.kind).toBe(kind);
  expect(view.kind === "entry" ? view.entry.kind : undefined).toBe(entry);
});

function text(id: string, markdown: string, status: PartStatus): TextMessage {
  return {
    id: asId<"message">(id),
    turn: asId<"turn">("t"),
    at: 7,
    kind: "part",
    part: asId<"part">(id),
    partKind: "text",
    role: "answer",
    state: { markdown, signature: null },
    version: 1,
    status,
  };
}

const settledText = (id: string, markdown: string) =>
  text(id, markdown, { kind: "settled", commit: asId<"commit">(id), endedAt: 9 });

type ResponseRow = Extract<TurnItemRow, { readonly kind: "response" }>;

const ended = { ended: true, latest: true, workedMs: 65_000 } as const;

test.each<[string, ResponseRow, ReturnType<typeof responseRowView>]>([
  [
    "a finished latest reply joins its parts, trimmed, and keeps its last commit",
    {
      ...LAYOUT,
      kind: "response",
      messages: [settledText("a", " First "), settledText("b", "Second\n")],
      ...ended,
    },
    {
      markdown: "First\n\nSecond",
      streaming: false,
      at: 7,
      ended: true,
      latest: true,
      worked: "Worked for 1m 5s",
      commit: asId<"commit">("b"),
    },
  ],
  [
    "a blank part between two keeps its gap",
    {
      ...LAYOUT,
      kind: "response",
      messages: [settledText("a", "One"), settledText("b", "  "), settledText("c", "Two")],
      ...ended,
    },
    expect.objectContaining({ markdown: "One\n\n\n\nTwo" }),
  ],
  [
    "two blank parts still draw a reply",
    {
      ...LAYOUT,
      kind: "response",
      messages: [settledText("a", " "), settledText("b", "")],
      ended: true,
      latest: false,
      workedMs: undefined,
    },
    expect.objectContaining({ markdown: "\n\n", latest: false, worked: undefined }),
  ],
  [
    "one blank part draws nothing",
    { ...LAYOUT, kind: "response", messages: [settledText("a", "  ")], ...ended },
    null,
  ],
  ["no parts draw nothing", { ...LAYOUT, kind: "response", messages: [], ...ended }, null],
  [
    "a streaming reply is not latest, has no work line and no commit",
    { ...LAYOUT, kind: "response", messages: [text("a", "Streaming", LIVE)], ended: false },
    {
      markdown: "Streaming",
      streaming: true,
      at: 7,
      ended: false,
      latest: false,
      worked: undefined,
      commit: undefined,
    },
  ],
])("%s", (_, row, view) => {
  expect(responseRowView(row)).toEqual(view);
});

function user(source: MessageSource): UserMessage {
  return {
    id: asId<"message">("u"),
    turn: asId<"turn">("t"),
    at: 1,
    kind: "user",
    content: "Content",
    source,
    delivery: "steer",
    status: { kind: "landed", commit: asId<"commit">("u"), run: null, replaced: null },
    siblings: { index: 0, count: 1, ids: [] },
  };
}

const CHILD: MessageSource = { kind: "child", session: asId<"session">("c"), end: "completed" };

const JOB: MessageSource = { kind: "job", job: asId<"job">("j") };

const ANSWER: MessageSource = { kind: "answer", part: asId<"part">("q"), label: "Yes" };

const ACTION: MessageSource = { kind: "action", label: "Run checks" };

function prompt(source: MessageSource, held: boolean, pending: boolean): PromptRow {
  return { ...LAYOUT, kind: "prompt", message: user(source), held, pending };
}

function part(message: Message): Extract<TurnItemRow, { readonly kind: "part" }> {
  return { ...LAYOUT, kind: "part", message };
}

test.each<
  [string, PromptRow | Extract<TurnItemRow, { readonly kind: "part" }>, object | undefined]
>([
  [
    "a pending prompt draws the user's message, not editable",
    prompt({ kind: "user" }, false, true),
    { kind: "user", content: "Content", pending: true, editable: false },
  ],
  [
    "a held child report prompt is wrapped and held",
    prompt(CHILD, true, false),
    { kind: "report", source: CHILD, content: "Content", held: true, wrapped: true },
  ],
  [
    "a job report prompt is wrapped",
    prompt(JOB, false, false),
    { kind: "report", source: JOB, content: "Content", held: false, wrapped: true },
  ],
  [
    "a held answer prompt is wrapped and held",
    prompt(ANSWER, true, true),
    { kind: "answer", held: true, wrapped: true },
  ],
  [
    "an action prompt draws its label",
    prompt(ACTION, false, false),
    { kind: "user", content: "Run checks", pending: false, editable: false },
  ],
  [
    "a user message in a turn is editable",
    part(user({ kind: "user" })),
    { kind: "user", content: "Content", pending: false, editable: true },
  ],
  [
    "an action in a turn draws its label and is not editable",
    part(user(ACTION)),
    { kind: "user", content: "Run checks", pending: false, editable: false },
  ],
  [
    "a shell message in a turn is editable",
    part(user({ kind: "shell" })),
    { kind: "user", content: "Content", pending: false, editable: true },
  ],
  [
    "a report in a turn is neither wrapped nor held",
    part(user(CHILD)),
    { kind: "report", source: CHILD, content: "Content", held: false, wrapped: false },
  ],
  [
    "an answer in a turn is neither wrapped nor held",
    part(user(ANSWER)),
    { kind: "answer", held: false, wrapped: false },
  ],
  ["a part that is not a user message is not a user row", part(read("a")), undefined],
])("%s", (_, row, view) => {
  expect(userRowView(row)).toEqual(view === undefined ? undefined : expect.objectContaining(view));
});

const changes = (state: "pending" | "ready"): TranscriptRow => ({
  ...LAYOUT,
  kind: "changes",
  state,
  files: [],
});

const live = (state: "idle" | "planning" | "grouped"): TranscriptRow => ({
  ...LAYOUT,
  kind: "live",
  state,
});

test.each<[string, TranscriptRow, boolean, TranscriptRow | "same"]>([
  ["ready changes show as ready", changes("ready"), false, "same"],
  ["ready changes wait while an edit saves", changes("ready"), true, changes("pending")],
  ["pending changes stay as they are", changes("pending"), true, "same"],
  ["an idle live row stays idle", live("idle"), false, "same"],
  ["an idle live row plans while an edit saves", live("idle"), true, live("planning")],
  ["a grouped live row stays grouped while an edit saves", live("grouped"), true, "same"],
  ["a planning live row stays planning", live("planning"), true, "same"],
  ["other rows pass through", { ...LAYOUT, kind: "retry", message: "x" }, true, "same"],
])("%s", (_, row, navigating, shown) => {
  if (shown === "same") expect(shownRow(row, navigating)).toBe(row);
  else expect(shownRow(row, navigating)).toEqual(shown);
});
