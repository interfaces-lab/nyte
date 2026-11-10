import { asId } from "@nyte-ai/schema";
import { describe, expect, test } from "bun:test";
import type { ChatCommand } from "../../src/lib/constants.ts";
import { reduceDialog } from "../../src/model/dialogs/dialog.ts";
import type { Dialog } from "../../src/model/dialogs/dialog.ts";
import { CHAT_COMMANDS, dialogKeys, interactionsFor } from "../../src/model/interactions.ts";
import type { CoreCommand, Interactions } from "../../src/model/interactions.ts";
import { tableInput } from "../fixture/table.ts";
import type { TableSpec } from "../fixture/table.ts";

const ENTER = "chat.submit";

const CTRL_ENTER = "chat.queue.submit";

const ESC = "chat.interrupt";

const CTRL_C = "chat.quit";

type Interaction = Interactions[ChatCommand];

type Check = (interaction: Interaction) => void;

function is(expected: Interaction): Check {
  return (interaction) => expect(interaction).toEqual(expected);
}

function does(expected: Interaction["intent"]): Check {
  return (interaction) => expect(interaction.intent).toEqual(expected);
}

interface Subset {
  readonly intent: Partial<NonNullable<Interaction["intent"]>>;
  readonly label?: string;
  readonly hidden?: boolean;
}

function like(expected: Subset): Check {
  return (interaction) => expect(interaction).toMatchObject(expected);
}

const CASES: readonly (readonly [string, TableSpec, ChatCommand, Check])[] = [
  [
    "blocked: Enter refuses with the reason and hides its hint",
    { blocked: "switching", draft: "hi" },
    ENTER,
    is({
      intent: { kind: "refuse", reason: "Opening the chat. Your draft is saved here." },
      label: "send",
      hidden: true,
    }),
  ],
  [
    "blocked: Ctrl+Enter refuses the same way",
    { blocked: "switching", draft: "hi" },
    CTRL_ENTER,
    does({ kind: "refuse", reason: "Opening the chat. Your draft is saved here." }),
  ],
  [
    "blocked: Esc cancels authentication",
    { blocked: "authenticating" },
    ESC,
    like({ intent: { kind: "cancel-auth" }, label: "cancel authentication" }),
  ],
  [
    "blocked: Esc passes otherwise and opens nothing while blocked",
    { blocked: "switching" },
    ESC,
    does({ kind: "noop" }),
  ],
  [
    "blocked: Ctrl+C clears a draft typed while blocked instead of quitting",
    { blocked: "switching", draft: "keep" },
    CTRL_C,
    does({ kind: "clear-draft" }),
  ],
  [
    "blocked: Ctrl+C on an empty draft quits",
    { blocked: "switching" },
    CTRL_C,
    does({ kind: "quit" }),
  ],
  [
    "completion: Enter accepts",
    { completion: "slash", draft: "/re" },
    ENTER,
    like({
      intent: { kind: "completion", action: { kind: "accept", alternate: null } },
      hidden: true,
    }),
  ],
  [
    "completion: Enter on /cd passes, so the typed path runs",
    { completion: "cd", draft: "/cd sr" },
    ENTER,
    does({ kind: "send", delivery: "queue" }),
  ],
  [
    "completion: Ctrl+Enter on a skill accepts, then sends with the alternate delivery",
    { completion: "skill", draft: "/re", run: "working", followUp: "steer" },
    CTRL_ENTER,
    does({ kind: "completion", action: { kind: "accept", alternate: "queue" } }),
  ],
  [
    "completion: Ctrl+Enter on a non-skill does nothing, so the half-typed token is not sent",
    { completion: "slash", draft: "/re", run: "working" },
    CTRL_ENTER,
    does({ kind: "noop" }),
  ],
  [
    "completion: Ctrl+Enter on /cd passes, so the typed path runs",
    { completion: "cd", draft: "/cd sr", run: "working" },
    CTRL_ENTER,
    does({ kind: "send", delivery: "queue" }),
  ],
  [
    "completion: Enter on an empty menu sends",
    { completion: "empty", draft: "/zz" },
    ENTER,
    does({ kind: "send", delivery: "queue" }),
  ],
  [
    "completion: an empty menu only closes",
    { completion: "empty", draft: "/zz" },
    "completion.close",
    does({ kind: "completion", action: { kind: "close" } }),
  ],
  [
    "completion: Tab does nothing on an empty menu",
    { completion: "empty", draft: "/zz" },
    "completion.fill",
    does(null),
  ],
  [
    "completion: Down does nothing on an empty menu",
    { completion: "empty", draft: "/zz" },
    "completion.next",
    does(null),
  ],
  [
    "completion: Page Up does nothing on an empty menu",
    { completion: "empty", draft: "/zz" },
    "completion.page.up",
    does(null),
  ],
  [
    "completion: Esc closes the menu",
    { completion: "slash", draft: "/re", run: "working" },
    ESC,
    does({ kind: "completion", action: { kind: "close" } }),
  ],
  [
    "completion: Ctrl+C passes",
    { completion: "slash", draft: "/re" },
    CTRL_C,
    does({ kind: "clear-draft" }),
  ],
  [
    "shell running: Enter refuses a prompt, keeping the draft",
    { shell: true, draft: "next" },
    ENTER,
    does({
      kind: "refuse",
      reason: "A local command is running. Wait or press Esc; your draft is kept.",
    }),
  ],
  [
    "shell running: Enter refuses a ! command, keeping the draft",
    { shell: true, draft: "!ls" },
    ENTER,
    does({
      kind: "refuse",
      reason: "A local command is running. Esc stops it; your draft is kept.",
    }),
  ],
  [
    "shell running: Ctrl+Enter refuses a prompt, keeping the draft",
    { shell: true, draft: "next" },
    CTRL_ENTER,
    does({
      kind: "refuse",
      reason: "A local command is running. Wait or press Esc; your draft is kept.",
    }),
  ],
  [
    "shell running: Ctrl+Enter refuses a ! command, keeping the draft",
    { shell: true, draft: "!ls" },
    CTRL_ENTER,
    does({
      kind: "refuse",
      reason: "A local command is running. Esc stops it; your draft is kept.",
    }),
  ],
  [
    "shell running: a /command still runs",
    { shell: true, draft: "/usage" },
    ENTER,
    does({ kind: "send", delivery: "queue" }),
  ],
  [
    "shell running: Esc stops the command",
    { shell: true },
    ESC,
    like({ intent: { kind: "stop-shell" }, label: "stop command" }),
  ],
  [
    "shell running: Ctrl+C stops the command, without a second hint",
    { shell: true, draft: "x" },
    CTRL_C,
    like({ intent: { kind: "stop-shell" }, hidden: true }),
  ],
  [
    "editing a queued message: Enter saves with the message's own delivery",
    { editing: "queue", draft: "fixed" },
    ENTER,
    like({ intent: { kind: "save-edit", delivery: "queue" }, label: "save" }),
  ],
  [
    "editing a queued message: Enter on an empty draft refuses instead of saving nothing",
    { editing: "queue" },
    ENTER,
    like({ intent: { kind: "refuse" } }),
  ],
  [
    "editing a queued message: Ctrl+Enter saves as a steer",
    { editing: "queue", draft: "fixed" },
    CTRL_ENTER,
    does({ kind: "save-edit", delivery: "steer" }),
  ],
  [
    "editing a queued message: Esc cancels the edit",
    { editing: "steer", run: "working" },
    ESC,
    like({ intent: { kind: "cancel-edit" }, label: "cancel edit" }),
  ],
  [
    "editing a queued message: Ctrl+C clears a draft",
    { editing: "steer", draft: "x" },
    CTRL_C,
    does({ kind: "clear-draft" }),
  ],
  [
    "editing a queued message: Ctrl+C on an empty draft cancels the edit, never quits",
    { editing: "steer" },
    CTRL_C,
    does({ kind: "cancel-edit" }),
  ],
  [
    "shell draft: Enter runs `!` locally, sending its output with the next prompt",
    { draft: "!ls" },
    ENTER,
    is({
      intent: { kind: "run-shell", command: "ls", include: true },
      label: "run locally",
      hidden: false,
    }),
  ],
  [
    "shell draft: Enter runs `!!` privately",
    { draft: "!!ls" },
    ENTER,
    like({ intent: { kind: "run-shell", command: "ls", include: false }, label: "run privately" }),
  ],
  ["shell draft: Ctrl+Enter passes", { draft: "!ls" }, CTRL_ENTER, does({ kind: "noop" })],
  ["shell draft: Esc passes", { draft: "!ls", run: "working" }, ESC, does({ kind: "stop-run" })],
  ["shell draft: Ctrl+C passes", { draft: "!ls" }, CTRL_C, does({ kind: "clear-draft" })],
  [
    "question open: Enter with plain text answers the question",
    { question: "head", run: "waiting", draft: "Green" },
    ENTER,
    is({
      intent: {
        kind: "answer",
        session: asId("s1"),
        part: asId("q1"),
        value: "Green",
        typed: true,
      },
      label: "answer",
      hidden: false,
    }),
  ],
  [
    "question open: Enter answers a child's question too",
    { question: "child", draft: "Green" },
    ENTER,
    like({ intent: { kind: "answer", session: asId("s9") } }),
  ],
  [
    "question open: Enter with attachments sends a steer with a warning",
    { question: "head", run: "waiting", draft: "see", attachment: true },
    ENTER,
    like({
      intent: { kind: "send", delivery: "steer", warning: expect.stringContaining("Attachments") },
    }),
  ],
  [
    "question open: Enter on an empty draft reopens the picker",
    { question: "head", run: "waiting" },
    ENTER,
    does({ kind: "open-question" }),
  ],
  [
    "question open: Enter with a /command runs it rather than answering",
    { question: "head", run: "waiting", draft: "/model" },
    ENTER,
    does({ kind: "send", delivery: "steer" }),
  ],
  [
    "question open: Ctrl+Enter with a message sends a steer",
    { question: "head", run: "waiting", draft: "also", followUp: "steer" },
    CTRL_ENTER,
    does({ kind: "send", delivery: "steer" }),
  ],
  [
    "question open: Esc stops the run",
    { question: "head", run: "waiting" },
    ESC,
    does({ kind: "stop-run" }),
  ],
  [
    "question open: Esc passes when nothing runs",
    { question: "child" },
    ESC,
    like({ intent: { kind: "escape-tree" } }),
  ],
  [
    "question open: Ctrl+C passes",
    { question: "head", run: "waiting" },
    CTRL_C,
    does({ kind: "quit" }),
  ],
  [
    "busy: Enter with a message follows the setting: steer",
    { run: "working", draft: "fix it", followUp: "steer" },
    ENTER,
    like({ intent: { kind: "send", delivery: "steer" }, label: "steer" }),
  ],
  [
    "busy: Enter with a message follows the setting: queue, and the hint says so",
    { run: "working", draft: "fix it", followUp: "queue" },
    ENTER,
    is({ intent: { kind: "send", delivery: "queue" }, label: "queue", hidden: false }),
  ],
  [
    "busy: Enter on an empty draft promotes the first row a host covers",
    {
      run: "working",
      followUp: "queue",
      queue: [
        { id: "m1", place: "uncovered" },
        { id: "m2", place: "next-turn" },
      ],
    },
    ENTER,
    like({ intent: { kind: "promote", message: asId("m2") }, label: "send now" }),
  ],
  [
    "busy: Enter on an empty draft with nothing to promote does nothing",
    { run: "working", queue: [{ id: "m1", place: "sending" }] },
    ENTER,
    does({ kind: "noop" }),
  ],
  [
    "busy: Ctrl+Enter queues when the setting steers",
    { run: "working", draft: "x", followUp: "steer" },
    CTRL_ENTER,
    like({ intent: { kind: "send", delivery: "queue" }, label: "queue" }),
  ],
  [
    "busy: Ctrl+Enter steers when the setting queues",
    { run: "working", draft: "x", followUp: "queue" },
    CTRL_ENTER,
    does({ kind: "send", delivery: "steer" }),
  ],
  [
    "busy: Ctrl+Enter without a message is hidden",
    { run: "working" },
    CTRL_ENTER,
    like({ intent: { kind: "noop" }, hidden: true }),
  ],
  [
    "busy: Esc stops the run",
    { run: "retrying" },
    ESC,
    like({ intent: { kind: "stop-run" }, label: "stop" }),
  ],
  ["busy: Ctrl+C passes", { run: "working", draft: "x" }, CTRL_C, does({ kind: "clear-draft" })],
  [
    "idle: Enter with a message sends",
    { draft: "hello" },
    ENTER,
    is({ intent: { kind: "send", delivery: "queue" }, label: "send", hidden: false }),
  ],
  [
    "idle: Enter on an empty draft promotes a waiting row",
    { queue: [{ id: "m3", place: "next-turn" }] },
    ENTER,
    does({ kind: "promote", message: asId("m3") }),
  ],
  [
    "idle: Enter on an empty draft is a no-op that still shows `enter send`",
    {},
    ENTER,
    is({ intent: { kind: "noop" }, label: "send", hidden: false }),
  ],
  [
    "idle: Ctrl+Enter sends like Enter, without a hint",
    { draft: "hello" },
    CTRL_ENTER,
    is({ intent: { kind: "send", delivery: "queue" }, label: "send", hidden: true }),
  ],
  [
    "idle: Esc with a message refuses to open the tree",
    { draft: "hello" },
    ESC,
    like({ intent: { kind: "refuse" }, hidden: true }),
  ],
  [
    "idle: Esc on an empty draft arms the double-press tree",
    {},
    ESC,
    like({ intent: { kind: "escape-tree" }, label: "tree (twice)" }),
  ],
  [
    "idle: Ctrl+C clears a draft, whitespace included",
    { draft: "  " },
    CTRL_C,
    like({ intent: { kind: "clear-draft" }, label: "clear draft" }),
  ],
  [
    "idle: Ctrl+C on an empty draft quits",
    {},
    CTRL_C,
    like({ intent: { kind: "quit" }, label: "quit" }),
  ],
  [
    "Up steps history from the first wrapped row",
    { draft: "a\nb", row: "first" },
    "chat.history.previous",
    does({ kind: "history", direction: "previous" }),
  ],
  [
    "Up leaves a middle wrapped row to the textarea",
    { draft: "a\nb\nc", row: "middle" },
    "chat.history.previous",
    does(null),
  ],
  [
    "Down on an empty draft with tasks opens the task list",
    { tasks: 2 },
    "chat.history.next",
    like({
      intent: {
        kind: "open",
        dialog: { kind: "list", purpose: { kind: "tasks", section: "active" } },
      },
      label: "view tasks",
      hidden: false,
    }),
  ],
  [
    "Down while browsing history steps history even with tasks",
    { tasks: 2, browsing: true },
    "chat.history.next",
    does({ kind: "history", direction: "next" }),
  ],
  [
    "Ctrl+Q opens the queue on its first row",
    { queue: [{ id: "m4", place: "next-turn" }] },
    "chat.queue.open",
    does({
      kind: "open",
      dialog: { kind: "list", purpose: { kind: "queue", message: asId("m4") } },
    }),
  ],
  [
    "Ctrl+Q says an empty queue is empty",
    {},
    "chat.queue.open",
    like({ intent: { kind: "refuse", reason: "Nothing is queued" } }),
  ],
  [
    "Ctrl+K opens the palette",
    {},
    "chat.commands.open",
    like({ intent: { kind: "open" }, label: "help" }),
  ],
  ["Ctrl+K is off while blocked", { blocked: "switching" }, "chat.commands.open", does(null)],
  ["completion keys are off without a completion", {}, "completion.next", does(null)],
  [
    "completion keys are on while a completion is open",
    { completion: "slash", draft: "/re" },
    "completion.next",
    does({ kind: "completion", action: { kind: "move", by: 1 } }),
  ],
  [
    "completion accept is off for /cd",
    { completion: "cd", draft: "/cd sr" },
    "completion.accept",
    does(null),
  ],
  [
    "scroll keys scroll the transcript",
    {},
    "chat.scroll.page.up",
    does({ kind: "scroll", to: "page-up" }),
  ],
  [
    "scroll keys give way to the completion menu",
    { completion: "slash", draft: "/re" },
    "chat.scroll.page.up",
    does(null),
  ],
  ["the textarea's own keys are never ours", { draft: "x" }, "composer.newline", does(null)],
  [
    "a dialog gets its own keys, forwarded by name",
    { dialog: true },
    "picker.next",
    does({ kind: "dialog", command: { kind: "key", name: "picker.next" } }),
  ],
  ["a dialog takes Enter from the composer", { dialog: true, draft: "x" }, ENTER, does(null)],
];

test.each(CASES)("%s", (_name, spec, command, check) => {
  check(interactionsFor(tableInput(spec))[command]);
});

test("a text panel closes on Ctrl+C as well as Esc", () => {
  const panel: Dialog = {
    kind: "text",
    id: "x",
    title: "Plugins",
    body: { kind: "ready", lines: [] },
    scroll: 0,
  };

  expect(dialogKeys(panel)).toContain("tree.close");
  expect(reduceDialog(panel, { kind: "key", name: "tree.close" }).dialog).toBeNull();
});

const RUNS = ["idle", "working", "waiting", "retrying"] as const;

const QUESTIONS = [undefined, "head", "child"] as const;

const DRAFTS = [
  { draft: "" },
  { draft: "   " },
  { draft: "fix it" },
  { draft: "see", attachment: true },
  { draft: "!ls" },
  { draft: "/model" },
] as const;

const EDITING = [undefined, "queue"] as const;

const SHELL = [false, true] as const;

const COMPLETION = [undefined, "slash", "skill", "cd"] as const;

const BLOCKED = [undefined, "switching", "authenticating"] as const;

const FOLLOW_UP = ["steer", "queue"] as const;

const DIALOG = [false, true] as const;

const CORE: readonly CoreCommand[] = [ENTER, CTRL_ENTER, ESC, CTRL_C];

function* matrix(): Generator<TableSpec> {
  for (const run of RUNS)
    for (const question of QUESTIONS)
      for (const draft of DRAFTS)
        for (const editing of EDITING)
          for (const shell of SHELL)
            for (const completion of COMPLETION)
              for (const blocked of BLOCKED)
                for (const followUp of FOLLOW_UP)
                  for (const dialog of DIALOG)
                    yield {
                      run,
                      question,
                      ...draft,
                      editing,
                      shell,
                      completion,
                      blocked,
                      followUp,
                      dialog,
                    };
}

function sends(interactions: Interactions, command: ChatCommand): boolean {
  const kind = interactions[command].intent?.kind;

  return (
    kind === "send" ||
    kind === "answer" ||
    kind === "save-edit" ||
    kind === "run-shell" ||
    kind === "promote"
  );
}

describe("invariants over every situation", () => {
  const cases = [...matrix()];

  test(`${String(cases.length)} situations hold every rule`, () => {
    const broken: string[] = [];

    for (const spec of cases) {
      const input = tableInput(spec);
      const interactions = interactionsFor(input);
      const label = JSON.stringify(spec);

      const fail = (rule: string): void => {
        broken.push(`${rule}: ${label}`);
      };

      if (spec.dialog) {
        for (const command of CHAT_COMMANDS) {
          const intent = interactions[command].intent;

          if (intent !== null && intent.kind !== "dialog") fail(`dialog leaves ${command} on`);
        }

        continue;
      }

      for (const command of CORE) {
        const interaction = interactions[command];

        if (interaction.intent === null) fail(`${command} has no interaction`);

        if (!interaction.hidden && interaction.label === "") fail(`${command} shows an empty hint`);
      }

      if (spec.blocked !== undefined && sends(interactions, ENTER))
        fail("Enter sends while blocked");

      if (
        spec.shell &&
        sends(interactions, ENTER) &&
        !input.runsCommand &&
        input.draft.kind !== "empty" &&
        input.draft.kind !== "blank"
      )
        fail("Enter sends a prompt while a shell runs");

      if (
        spec.blocked === undefined &&
        input.completion?.ownsEnter === true &&
        interactions[ENTER].intent?.kind !== "completion"
      )
        fail("completion does not own Enter");

      if (input.draft.kind === "empty" || input.draft.kind === "blank")
        for (const command of CORE)
          if (interactions[command].intent?.kind === "send") fail(`${command} sends a blank draft`);

      if (input.draft.kind !== "empty" && interactions[CTRL_C].intent?.kind === "quit")
        fail("Ctrl+C quits with text");
    }

    expect(broken.slice(0, 10)).toEqual([]);
  });
});
