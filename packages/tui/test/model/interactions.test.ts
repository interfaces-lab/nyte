/**
 * The table is the spec. One test per cell of the header table, plus a
 * generated matrix: every combination of run × question × draft × editing ×
 * shell × completion × blocked × followUp × dialog, asserting the invariants:
 * - every core key has an interaction, and a visible hint has a label;
 * - Enter never sends while blocked or while a shell runs; an open completion owns it unless blocked;
 * - no row emits `send` for an empty or blank draft;
 * - Ctrl+C is never `quit` while the draft has text;
 * - with a dialog open every interaction is off or forwarded to the dialog.
 */
import { asId } from "@nyte-ai/schema";
import { describe, expect, test } from "bun:test";
import type { ChatCommand } from "../../src/lib/constants.ts";
import { reduceDialog } from "../../src/model/dialogs/dialog.ts";
import type { Dialog } from "../../src/model/dialogs/dialog.ts";
import { chatCommands, dialogKeys, interactionsFor } from "../../src/model/interactions.ts";
import type { CoreCommand, Interactions } from "../../src/model/interactions.ts";
import { tableInput } from "../fixture/table.ts";
import type { TableSpec } from "../fixture/table.ts";

const ENTER = "chat.submit";

const CTRL_ENTER = "chat.queue.submit";

const ESC = "chat.interrupt";

const CTRL_C = "chat.quit";

function at(spec: TableSpec, command: ChatCommand) {
  return interactionsFor(tableInput(spec))[command];
}

describe("blocked", () => {
  test("Enter refuses with the reason and hides its hint", () => {
    expect(at({ blocked: "starting", draft: "hi" }, ENTER)).toEqual({
      intent: { kind: "refuse", reason: "Still starting. Your draft is saved here." },
      label: "send",
      hidden: true,
    });
  });

  test("Ctrl+Enter refuses the same way", () => {
    expect(at({ blocked: "switching", draft: "hi" }, CTRL_ENTER).intent).toEqual({
      kind: "refuse",
      reason: "Wait for the chat switch",
    });
  });

  test("Esc cancels authentication", () => {
    expect(at({ blocked: "authenticating" }, ESC)).toMatchObject({
      intent: { kind: "cancel-auth" },
      label: "cancel authentication",
    });
  });

  test("Esc passes otherwise and opens nothing while blocked", () => {
    expect(at({ blocked: "starting" }, ESC).intent).toEqual({ kind: "noop" });
  });

  test("Ctrl+C passes: it clears a draft typed during startup instead of quitting", () => {
    expect(at({ blocked: "starting", draft: "keep" }, CTRL_C).intent).toEqual({
      kind: "clear-draft",
    });
    expect(at({ blocked: "starting" }, CTRL_C).intent).toEqual({ kind: "quit" });
  });
});

describe("completion", () => {
  test("Enter accepts", () => {
    expect(at({ completion: "slash", draft: "/re" }, ENTER)).toMatchObject({
      intent: { kind: "completion", action: { kind: "accept", alternate: null } },
      hidden: true,
    });
  });

  test("Enter on /cd passes, so the typed path runs", () => {
    expect(at({ completion: "cd", draft: "/cd sr" }, ENTER).intent).toEqual({
      kind: "send",
      delivery: "queue",
    });
  });

  test("Ctrl+Enter on a skill accepts, then sends with the alternate delivery", () => {
    expect(
      at({ completion: "skill", draft: "/re", run: "working", followUp: "steer" }, CTRL_ENTER)
        .intent,
    ).toEqual({
      kind: "completion",
      action: { kind: "accept", alternate: "queue" },
    });
  });

  test("Ctrl+Enter on a non-skill passes", () => {
    expect(at({ completion: "slash", draft: "/re", run: "working" }, CTRL_ENTER).intent).toEqual({
      kind: "send",
      delivery: "queue",
    });
  });

  test("Esc closes the menu", () => {
    expect(at({ completion: "slash", draft: "/re", run: "working" }, ESC).intent).toEqual({
      kind: "completion",
      action: { kind: "close" },
    });
  });

  test("Ctrl+C passes", () => {
    expect(at({ completion: "slash", draft: "/re" }, CTRL_C).intent).toEqual({
      kind: "clear-draft",
    });
  });
});

describe("shell running", () => {
  test("Enter refuses", () => {
    expect(at({ shell: true, draft: "next" }, ENTER).intent).toMatchObject({ kind: "refuse" });
  });

  test("Ctrl+Enter refuses", () => {
    expect(at({ shell: true, draft: "next" }, CTRL_ENTER).intent).toMatchObject({ kind: "refuse" });
  });

  test("Esc stops the command", () => {
    expect(at({ shell: true }, ESC)).toMatchObject({
      intent: { kind: "stop-shell" },
      label: "stop command",
    });
  });

  test("Ctrl+C stops the command, without a second hint", () => {
    expect(at({ shell: true, draft: "x" }, CTRL_C)).toMatchObject({
      intent: { kind: "stop-shell" },
      hidden: true,
    });
  });
});

describe("editing a queued message", () => {
  test("Enter saves with the message's own delivery", () => {
    expect(at({ editing: "queue", draft: "fixed" }, ENTER)).toMatchObject({
      intent: { kind: "save-edit", delivery: "queue" },
      label: "save",
    });
  });

  test("Enter on an empty draft refuses instead of saving nothing", () => {
    expect(at({ editing: "queue" }, ENTER).intent).toMatchObject({ kind: "refuse" });
  });

  test("Ctrl+Enter saves as a steer", () => {
    expect(at({ editing: "queue", draft: "fixed" }, CTRL_ENTER).intent).toEqual({
      kind: "save-edit",
      delivery: "steer",
    });
  });

  test("Esc cancels the edit", () => {
    expect(at({ editing: "steer", run: "working" }, ESC)).toMatchObject({
      intent: { kind: "cancel-edit" },
      label: "cancel edit",
    });
  });

  test("Ctrl+C clears a draft, else cancels the edit (never quits)", () => {
    expect(at({ editing: "steer", draft: "x" }, CTRL_C).intent).toEqual({ kind: "clear-draft" });
    expect(at({ editing: "steer" }, CTRL_C).intent).toEqual({ kind: "cancel-edit" });
  });
});

describe("shell draft", () => {
  test("Enter runs `!` locally, sending its output with the next prompt", () => {
    expect(at({ draft: "!ls" }, ENTER)).toEqual({
      intent: { kind: "run-shell", command: "ls", include: true },
      label: "run locally",
      hidden: false,
    });
  });

  test("Enter runs `!!` privately", () => {
    expect(at({ draft: "!!ls" }, ENTER)).toMatchObject({
      intent: { kind: "run-shell", command: "ls", include: false },
      label: "run privately",
    });
  });

  test("Ctrl+Enter passes", () => {
    expect(at({ draft: "!ls" }, CTRL_ENTER).intent).toEqual({ kind: "noop" });
  });

  test("Esc passes", () => {
    expect(at({ draft: "!ls", run: "working" }, ESC).intent).toEqual({ kind: "stop-run" });
  });

  test("Ctrl+C passes", () => {
    expect(at({ draft: "!ls" }, CTRL_C).intent).toEqual({ kind: "clear-draft" });
  });
});

describe("question open", () => {
  test("Enter with plain text answers the question", () => {
    expect(at({ question: "head", run: "waiting", draft: "Green" }, ENTER)).toEqual({
      intent: {
        kind: "answer",
        session: asId("s1"),
        part: asId("q1"),
        choice: "Green",
        typed: true,
      },
      label: "answer",
      hidden: false,
    });
  });

  test("Enter answers a child's question too", () => {
    expect(at({ question: "child", draft: "Green" }, ENTER).intent).toMatchObject({
      kind: "answer",
      session: "s9",
    });
  });

  test("Enter with attachments sends a steer with a warning", () => {
    expect(
      at({ question: "head", run: "waiting", draft: "see", attachment: true }, ENTER).intent,
    ).toMatchObject({
      kind: "send",
      delivery: "steer",
      warning: expect.stringContaining("Attachments"),
    });
  });

  test("Enter on an empty draft reopens the picker", () => {
    expect(at({ question: "head", run: "waiting" }, ENTER).intent).toEqual({
      kind: "open-question",
    });
  });

  test("Enter with a /command runs it rather than answering", () => {
    expect(at({ question: "head", run: "waiting", draft: "/model" }, ENTER).intent).toEqual({
      kind: "send",
      delivery: "steer",
    });
  });

  test("Ctrl+Enter with a message sends a steer", () => {
    expect(
      at({ question: "head", run: "waiting", draft: "also", followUp: "steer" }, CTRL_ENTER).intent,
    ).toEqual({
      kind: "send",
      delivery: "steer",
    });
  });

  test("Esc stops the run", () => {
    expect(at({ question: "head", run: "waiting" }, ESC).intent).toEqual({ kind: "stop-run" });
  });

  test("Esc passes when nothing runs", () => {
    expect(at({ question: "child" }, ESC).intent).toMatchObject({ kind: "escape-tree" });
  });

  test("Ctrl+C passes", () => {
    expect(at({ question: "head", run: "waiting" }, CTRL_C).intent).toEqual({ kind: "quit" });
  });
});

describe("busy", () => {
  test("Enter with a message follows the setting: steer", () => {
    expect(at({ run: "working", draft: "fix it", followUp: "steer" }, ENTER)).toMatchObject({
      intent: { kind: "send", delivery: "steer" },
      label: "steer",
    });
  });

  test("Enter with a message follows the setting: queue, and the hint says so", () => {
    const interactions = interactionsFor(
      tableInput({ run: "working", draft: "fix it", followUp: "queue" }),
    );

    expect(interactions[ENTER].intent).toEqual({ kind: "send", delivery: "queue" });
    expect(interactions[ENTER].label).toBe("queue");
  });

  test("Enter on an empty draft promotes the first row that has not joined the run", () => {
    expect(
      at(
        {
          run: "working",
          followUp: "queue",
          queue: [
            { id: "m1", place: "joining" },
            { id: "m2", place: "next-turn" },
          ],
        },
        ENTER,
      ),
    ).toMatchObject({ intent: { kind: "promote", message: asId("m2") }, label: "send now" });
  });

  test("Enter on an empty draft with nothing to promote does nothing", () => {
    expect(at({ run: "working", queue: [{ id: "m1", place: "sending" }] }, ENTER).intent).toEqual({
      kind: "noop",
    });
  });

  test("Ctrl+Enter sends with the other delivery", () => {
    expect(at({ run: "working", draft: "x", followUp: "steer" }, CTRL_ENTER)).toMatchObject({
      intent: { kind: "send", delivery: "queue" },
      label: "queue",
    });
    expect(at({ run: "working", draft: "x", followUp: "queue" }, CTRL_ENTER).intent).toEqual({
      kind: "send",
      delivery: "steer",
    });
  });

  test("Ctrl+Enter without a message is hidden", () => {
    expect(at({ run: "working" }, CTRL_ENTER)).toMatchObject({
      intent: { kind: "noop" },
      hidden: true,
    });
  });

  test("Esc stops the run", () => {
    expect(at({ run: "retrying" }, ESC)).toMatchObject({
      intent: { kind: "stop-run" },
      label: "stop",
    });
  });

  test("Ctrl+C passes", () => {
    expect(at({ run: "working", draft: "x" }, CTRL_C).intent).toEqual({ kind: "clear-draft" });
  });
});

describe("idle", () => {
  test("Enter with a message sends", () => {
    expect(at({ draft: "hello" }, ENTER)).toEqual({
      intent: { kind: "send", delivery: "queue" },
      label: "send",
      hidden: false,
    });
  });

  test("Enter on an empty draft promotes a waiting row", () => {
    expect(at({ queue: [{ id: "m3", place: "next-turn" }] }, ENTER).intent).toEqual({
      kind: "promote",
      message: asId("m3"),
    });
  });

  test("Enter on an empty draft is a no-op that still shows `enter send`", () => {
    expect(at({}, ENTER)).toEqual({ intent: { kind: "noop" }, label: "send", hidden: false });
  });

  test("Ctrl+Enter sends like Enter, without a hint", () => {
    expect(at({ draft: "hello" }, CTRL_ENTER)).toEqual({
      intent: { kind: "send", delivery: "queue" },
      label: "send",
      hidden: true,
    });
  });

  test("Esc with a message refuses to open the tree", () => {
    expect(at({ draft: "hello" }, ESC)).toMatchObject({ intent: { kind: "refuse" }, hidden: true });
  });

  test("Esc on an empty draft arms the double-press tree", () => {
    expect(at({}, ESC)).toMatchObject({ intent: { kind: "escape-tree" }, label: "tree (twice)" });
  });

  test("Ctrl+C clears a draft, whitespace included", () => {
    expect(at({ draft: "  " }, CTRL_C)).toMatchObject({
      intent: { kind: "clear-draft" },
      label: "clear draft",
    });
  });

  test("Ctrl+C on an empty draft quits", () => {
    expect(at({}, CTRL_C)).toMatchObject({ intent: { kind: "quit" }, label: "quit" });
  });
});

describe("other commands", () => {
  test("Up steps history only from the first wrapped row", () => {
    expect(at({ draft: "a\nb", row: "first" }, "chat.history.previous").intent).toEqual({
      kind: "history",
      direction: "previous",
    });
    expect(at({ draft: "a\nb\nc", row: "middle" }, "chat.history.previous").intent).toBeNull();
  });

  test("Down on an empty draft with tasks opens the task list", () => {
    expect(at({ tasks: 2 }, "chat.history.next")).toMatchObject({
      intent: {
        kind: "open",
        dialog: { kind: "list", purpose: { kind: "tasks", section: "active" } },
      },
      label: "view tasks",
      hidden: false,
    });
    expect(at({ tasks: 2, browsing: true }, "chat.history.next").intent).toEqual({
      kind: "history",
      direction: "next",
    });
  });

  test("Ctrl+Q opens the queue on its first row, or says it is empty", () => {
    expect(at({ queue: [{ id: "m4", place: "next-turn" }] }, "chat.queue.open").intent).toEqual({
      kind: "open",
      dialog: { kind: "list", purpose: { kind: "queue", message: asId("m4") } },
    });
    expect(at({}, "chat.queue.open").intent).toMatchObject({
      kind: "refuse",
      reason: "Nothing is queued",
    });
  });

  test("Ctrl+K opens the palette unless blocked", () => {
    expect(at({}, "chat.commands.open")).toMatchObject({ intent: { kind: "open" }, label: "help" });
    expect(at({ blocked: "starting" }, "chat.commands.open").intent).toBeNull();
  });

  test("completion keys are on only while a completion is open", () => {
    expect(at({}, "completion.next").intent).toBeNull();
    expect(at({ completion: "slash", draft: "/re" }, "completion.next").intent).toEqual({
      kind: "completion",
      action: { kind: "move", by: 1 },
    });
    expect(at({ completion: "cd", draft: "/cd sr" }, "completion.accept").intent).toBeNull();
  });

  test("scroll keys give way to the completion menu", () => {
    expect(at({}, "chat.scroll.page.up").intent).toEqual({ kind: "scroll", to: "page-up" });
    expect(at({ completion: "slash", draft: "/re" }, "chat.scroll.page.up").intent).toBeNull();
  });

  test("the textarea's own keys are never ours", () => {
    expect(at({ draft: "x" }, "composer.newline").intent).toBeNull();
  });

  test("a dialog gets its own keys, forwarded by name", () => {
    expect(at({ dialog: true }, "picker.next").intent).toEqual({
      kind: "dialog",
      command: { kind: "key", name: "picker.next" },
    });
    expect(at({ dialog: true, draft: "x" }, ENTER).intent).toBeNull();
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

const BLOCKED = [undefined, "starting", "authenticating"] as const;

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
        for (const command of chatCommands()) {
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

      if (spec.shell && sends(interactions, ENTER)) fail("Enter sends while a shell runs");

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
