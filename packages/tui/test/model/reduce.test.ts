import { asId } from "@nyte-ai/schema";
import type { SessionView } from "@nyte-ai/sdk";
import { describe, expect, test } from "bun:test";
import type { Task } from "../../src/lib/tasks.ts";
import { indexedMention } from "../../src/model/completion.ts";
import type { Effect } from "../../src/model/effect.ts";
import { reduce } from "../../src/model/reduce.ts";
import { deriveScreen } from "../../src/model/screen.ts";
import { viewOf } from "../fixture/view.ts";
import { NOW, play, ready, S1, typed } from "./support.ts";

const queued = viewOf((v) =>
  v
    .turn("t1", (t) => t.user("go"))
    .live()
    .pending("joined", { schedule: { kind: "joined", run: "run-t1" } }, { id: "m1" })
    .pending(
      "first",
      { schedule: { kind: "next-turn", reason: "run-ended" } },
      { id: "m2", delivery: "queue" },
    )
    .pending(
      "second",
      { schedule: { kind: "next-turn", reason: "run-ended" } },
      { id: "m3", delivery: "queue" },
    )
    .unsent("sending", { id: "m4" }),
);

const idle = viewOf((v) =>
  v
    .turn("t1", (t) => t.user("first prompt").text("ok").ended("completed"))
    .turn("t2", (t) => t.report({ child: "s9" }, "report").text("noted").ended("completed"))
    .turn("t3", (t) => t.action("Fix lint", "long hidden prompt").text("done").ended("completed"))
    .turn("t4", (t) =>
      t.user('see <shell command="ls" exit="0">\nout\n</shell>').text("ok").ended("completed"),
    ),
);

function kinds(effects: readonly Effect[]): readonly string[] {
  return effects.map((effect) =>
    effect.kind === "composer" ? `composer:${effect.op.kind}` : effect.kind,
  );
}

describe("queue operations", () => {
  test("withdraw goes out only for a pending row, through the receipt of that message", () => {
    const state = ready(queued);

    expect(play(state, { kind: "withdraw", message: asId("m2") }).effects).toEqual([
      { kind: "withdraw", session: S1, message: asId("m2") },
    ]);
    expect(play(state, { kind: "withdraw", message: asId("m4") }).effects).toEqual([]);
    expect(play(state, { kind: "withdraw", message: asId("gone") }).state.local.notice?.text).toBe(
      "Already sent",
    );
  });

  test("promote revises a waiting row to steer in place, never one already joining", () => {
    const state = ready(queued);

    expect(play(state, { kind: "promote", message: asId("m3") }).effects).toEqual([
      {
        kind: "revise",
        session: S1,
        message: asId("m3"),
        content: "second",
        delivery: "steer",
        position: null,
      },
    ]);
    expect(play(state, { kind: "promote", message: asId("m1") }).effects).toEqual([]);
  });

  test("reorder positions against the one inbox order", () => {
    const state = ready(queued);
    const revise = (message: string, to: Parameters<typeof reduce>[1]) => play(state, to).effects;

    expect(revise("m3", { kind: "reorder", message: asId("m3"), to: "earlier" })).toMatchObject([
      {
        kind: "revise",
        message: "m3",
        delivery: "queue",
        position: { kind: "before", message: "m2" },
      },
    ]);
    expect(revise("m1", { kind: "reorder", message: asId("m1"), to: "later" })).toMatchObject([
      { kind: "revise", message: "m1", position: { kind: "before", message: "m3" } },
    ]);
    expect(revise("m2", { kind: "reorder", message: asId("m2"), to: "later" })).toMatchObject([
      { kind: "revise", message: "m2", position: { kind: "last" } },
    ]);
    expect(revise("m1", { kind: "reorder", message: asId("m1"), to: "earlier" })).toEqual([]);
    expect(
      revise("m1", { kind: "reorder", message: asId("m1"), to: { before: asId("m3") } }),
    ).toMatchObject([{ kind: "revise", position: { kind: "before", message: "m3" } }]);
    expect(
      revise("m1", { kind: "reorder", message: asId("m1"), to: { before: null } }),
    ).toMatchObject([{ kind: "revise", message: "m1", position: { kind: "last" } }]);
    expect(revise("m3", { kind: "reorder", message: asId("m3"), to: { before: null } })).toEqual(
      [],
    );
  });

  test("editing a queued message loads it, saving revises it with replace, the old draft comes back", () => {
    const state = play(ready(queued), typed("my own draft")).state;
    const editing = play(state, { kind: "edit-queued", message: asId("m2") });

    expect(editing.effects).toEqual([
      { kind: "composer", op: { kind: "set", draft: { text: "first", parts: new Map() } } },
    ]);
    expect(editing.state.local.editing).toMatchObject({ message: "m2", delivery: "queue" });

    const saved = play(editing.state, typed("first, edited"), {
      kind: "save-edit",
      delivery: "queue",
    });

    expect(saved.effects).toEqual([
      { kind: "composer", op: { kind: "set", draft: { text: "my own draft", parts: new Map() } } },
      {
        kind: "send",
        submission: {
          id: "submission-1",
          session: S1,
          snapshot: { text: "first, edited", parts: new Map() },
          replace: asId("m2"),
        },
        delivery: "queue",
      },
    ]);
    expect(saved.state.local.editing).toBeNull();
    expect(
      play(saved.state, { kind: "sent", submission: "submission-1", message: asId("m2") }).state
        .local.notice?.text,
    ).toBe("Queued message saved.");
  });

  test("saving an unchanged edit sends nothing; cancel restores the draft", () => {
    const editing = play(ready(queued), { kind: "edit-queued", message: asId("m2") }).state;

    expect(
      kinds(play(editing, typed("first"), { kind: "save-edit", delivery: "queue" }).effects),
    ).toEqual(["composer:set"]);
    expect(play(editing, { kind: "cancel-edit" }).effects).toEqual([
      { kind: "composer", op: { kind: "set", draft: { text: "", parts: new Map() } } },
    ]);
  });

  test("an action row cannot be edited", () => {
    const view = viewOf((v) =>
      v
        .pending(
          "prompt",
          { schedule: { kind: "next-turn", reason: "run-ended" } },
          { id: "m1", source: { kind: "action", label: "Fix lint" } },
        )
        .live("run-1"),
    );

    expect(
      play(ready(view), { kind: "edit-queued", message: asId("m1") }).state.local.notice?.text,
    ).toBe('"Fix lint" is an action; it can\'t be edited.');
  });

  test("withdraw and revise outcomes are reported honestly", () => {
    const state = ready(queued);
    const notice = (msg: Parameters<typeof reduce>[1]) => play(state, msg).state.local.notice?.text;

    expect(notice({ kind: "withdrawn", message: asId("m2"), result: "withdrawn" })).toBe(
      "Removed from the queue",
    );
    expect(notice({ kind: "withdrawn", message: asId("m2"), result: "landed-first" })).toBe(
      "Already sent",
    );
    expect(notice({ kind: "withdrawn", message: asId("m2"), result: "gone" })).toBe(
      "No longer queued",
    );
    expect(notice({ kind: "revised", message: asId("m2"), result: "landed-first" })).toBe(
      "Already sent",
    );
  });
});

describe("send", () => {
  test("a prompt snapshots the draft, clears the composer at once, sends and returns to the latest output", () => {
    const scrolledUp = ready(idle);
    const reading = {
      ...scrolledUp,
      local: {
        ...scrolledUp.local,
        transcript: { ...scrolledUp.local.transcript, following: false },
      },
    };
    const step = play(reading, typed("fix the bug"), { kind: "send", delivery: "queue" });

    expect(step.effects).toEqual([
      { kind: "composer", op: { kind: "clear" } },
      {
        kind: "send",
        submission: {
          id: "submission-1",
          session: S1,
          snapshot: { text: "fix the bug", parts: new Map() },
          replace: null,
        },
        delivery: "queue",
      },
      { kind: "scroll", op: { kind: "latest" } },
    ]);
    expect(step.state.local.transcript.following).toBe(true);
    expect(step.state.local.draft.text).toBe("");
    expect(step.state.local.submissions).toHaveLength(1);
  });

  test("a built-in /command clears the draft and runs, it is never sent", () => {
    const step = play(ready(idle), typed("/compact focus on tests"), {
      kind: "send",
      delivery: "queue",
    });

    expect(step.effects).toEqual([
      { kind: "composer", op: { kind: "clear" } },
      { kind: "compact", session: S1, instructions: "focus on tests" },
    ]);
  });

  test("a skill named inside a /command draft makes the whole draft a prompt", () => {
    const withSkill: SessionView = {
      ...idle,
      catalog: {
        ...idle.catalog,
        skills: [{ name: "review", owner: "project", description: "", location: "/r" }],
      },
    };
    const step = play(ready(withSkill), typed("/compact then /review"), {
      kind: "send",
      delivery: "queue",
    });

    expect(kinds(step.effects)).toEqual(["composer:clear", "send", "scroll"]);
  });

  test("a setting command applies its argument", () => {
    const step = play(ready(idle), typed("/effort high"), { kind: "send", delivery: "queue" });

    expect(step.effects).toContainEqual({
      kind: "configure",
      session: S1,
      selection: { effort: "high" },
    });
    expect(step.state.facts.session?.selection.effort).toBe("high");
    expect(step.state.local.notice?.text).toBe("Thinking level: high");

    const again = play(step.state, typed("/effort high"), { kind: "send", delivery: "queue" });

    expect(again.state.local.notice?.text).toBe("Already using high");
  });

  test("choosing a theme says which", () => {
    const step = play(ready(idle), { kind: "write-settings", patch: { theme: "light" } });

    expect(step.state.local.notice?.text).toBe("Theme: light");
  });

  test("an unknown /name goes out as a message", () => {
    expect(
      kinds(play(ready(idle), typed("/nope"), { kind: "send", delivery: "queue" }).effects),
    ).toEqual(["composer:clear", "send", "scroll"]);
  });

  test("a /command that takes no argument says so", () => {
    expect(
      play(ready(idle), typed("/quit now"), { kind: "send", delivery: "queue" }).state.local.notice
        ?.text,
    ).toBe("/quit takes no argument");
  });

  test("attachments sent instead of an answer carry a warning", () => {
    const step = play(ready(idle), typed("x"), {
      kind: "send",
      delivery: "steer",
      warning: "sent as a message",
    });

    expect(step.state.local.notice).toMatchObject({ tone: "warning", text: "sent as a message" });
  });

  test("a typed answer clears the composer and keeps a snapshot to hand back", () => {
    const asking = viewOf((v) =>
      v
        .turn("t1", (t) => t.user("hi"))
        .question(
          [{ question: "Pick", header: "Question", options: [{ label: "A", description: "" }] }],
          { id: "q1" },
        )
        .waiting("q1"),
    );

    const step = play(ready(asking), typed("Green"), {
      kind: "answer",
      session: S1,
      part: asId("q1"),
      value: "Green",
      typed: true,
    });

    expect(step.effects).toEqual([
      { kind: "composer", op: { kind: "clear" } },
      {
        kind: "answer",
        session: S1,
        part: asId("q1"),
        answers: [["Green"]],
        typed: { session: S1, draft: { text: "Green", parts: new Map() } },
      },
    ]);

    const refused = play(step.state, {
      kind: "answered",
      request: { session: S1, part: asId("q1") },
      result: { kind: "gone" },
      typed: { session: S1, draft: { text: "Green", parts: new Map() } },
    });

    expect(refused.state.local.notice?.text).toBe("That question is no longer waiting");
    expect(kinds(refused.effects)).toEqual(["composer:set"]);
  });
});

describe("run control", () => {
  test("Esc twice within 500 ms opens the tree and loads it", () => {
    const state = ready(idle);
    const first = reduce(state, { kind: "escape-tree", at: 0 }, NOW);

    expect(first.effects).toEqual([]);

    const second = reduce(first.state, { kind: "escape-tree", at: 0 }, NOW + 300);

    expect(second.effects).toEqual([
      { kind: "load", dialog: "dialog-1", request: { kind: "tree", session: S1 } },
    ]);
    expect(reduce(first.state, { kind: "escape-tree", at: 0 }, NOW + 900).effects).toEqual([]);
  });

  test("stop goes to the live run", () => {
    expect(play(ready(queued), { kind: "stop-run" }).effects).toEqual([
      { kind: "stop-run", session: S1, run: asId("run-t1") },
    ]);
    expect(play(ready(idle), { kind: "stop-run" }).state.local.notice?.text).toBe(
      "No active run to stop.",
    );
  });
});

describe("history", () => {
  test("Up recalls the user's own messages with their markers, never reports or actions", () => {
    const state = ready(idle);
    const first = play(state, { kind: "history", direction: "previous" });

    expect(first.state.local.draft.text).toBe("see [Shell ls]");
    expect(first.state.local.draft.parts.get("[Shell ls]")).toMatchObject({
      kind: "shell",
      command: "ls",
    });

    const second = play(first.state, { kind: "history", direction: "previous" });

    expect(second.state.local.draft.text).toBe("first prompt");
    expect(play(second.state, { kind: "history", direction: "previous" }).effects).toEqual([]);
  });

  test("Down past the newest entry restores the draft the user had", () => {
    const state = play(ready(idle), typed("")).state;
    const recalled = play(state, { kind: "history", direction: "previous" }).state;
    const atEnd = play(recalled, { kind: "history", direction: "next" });

    expect(atEnd.effects).toEqual([{ kind: "composer", op: { kind: "cursor", to: "end" } }]);

    const back = play(atEnd.state, { kind: "history", direction: "next" });

    expect(back.state.local.draft.text).toBe("");
    expect(back.state.local.history).toBeNull();
  });

  test("Up away from the start moves the cursor first", () => {
    const state = play(ready(idle), typed("abc")).state;

    expect(play(state, { kind: "history", direction: "previous" }).effects).toEqual([
      { kind: "composer", op: { kind: "cursor", to: "start" } },
    ]);
  });

  test("typing ends history browsing", () => {
    const recalled = play(ready(idle), { kind: "history", direction: "previous" }).state;

    expect(play(recalled, typed("see [Shell ls]")).state.local.history).not.toBeNull();
    expect(play(recalled, typed("see [Shell ls]!")).state.local.history).toBeNull();
  });
});

describe("completion", () => {
  test("Enter on a leading action clears the draft and runs it", () => {
    const state = play(ready(idle), typed("/sett")).state;
    const screen = deriveScreen(state, null);

    expect(screen.completion?.items[0]?.id).toBe("settings");

    const step = play(state, { kind: "completion", action: { kind: "accept", alternate: null } });

    expect(kinds(step.effects)).toEqual(["composer:clear"]);
    expect(step.state.local.dialogs.at(-1)).toMatchObject({
      kind: "list",
      purpose: { kind: "settings" },
    });
  });

  test("Tab completes `/name ` without running it", () => {
    const step = play(ready(idle), typed("/sett"), {
      kind: "completion",
      action: { kind: "fill" },
    });

    expect(step.effects).toEqual([
      { kind: "composer", op: { kind: "replace-range", from: 0, to: 5, text: "/settings " } },
    ]);
    expect(step.state.local.draft.text).toBe("/settings ");
  });

  test("accepting /cd completes it and starts listing directories", () => {
    const step = play(ready(idle), typed("/c"), {
      kind: "completion",
      action: { kind: "move", by: 1 },
    });

    const cd =
      deriveScreen(step.state, null).completion?.items.findIndex((item) => item.id === "cd") ?? -1;

    const picked = play(
      step.state,
      { kind: "completion", action: { kind: "pick", index: cd } },
      typed("/cd "),
    );

    expect(picked.effects).toContainEqual({ kind: "list-directory", path: "", cwd: "/w" });

    const listed = play(picked.state, {
      kind: "directory-listed",
      path: "",
      entries: ["src/", "test/"],
    });

    expect(deriveScreen(listed.state, null).completion).toMatchObject({
      ownsEnter: false,
      items: [{ id: "src/" }, { id: "test/" }],
    });
  });

  test("an @ mention becomes a file marker with its part", () => {
    const state = play(
      ready(idle),
      {
        kind: "workspace",
        workspace: {
          cwd: "/w",
          branch: null,
          dirty: false,
          mentions: [indexedMention("/w", "src/app.ts"), indexedMention("/w", "src/")],
        },
      },
      typed("look @app"),
    ).state;

    const step = play(state, { kind: "completion", action: { kind: "accept", alternate: null } });

    expect(step.state.local.draft.text).toBe("look [File app.ts] ");
    expect(step.state.local.draft.parts.get("[File app.ts]")).toEqual({
      kind: "file",
      path: "/w/src/app.ts",
      directory: false,
    });
  });

  test("an @ path is resolved on disk, offered first, and a stale answer is dropped", () => {
    const outside = { path: "/notes/", display: "../notes/", label: "notes/" };
    const asked = play(ready(idle), typed("see @../no"));

    expect(asked.effects).toContainEqual({ kind: "resolve-mention", query: "../no", cwd: "/w" });
    expect(play(ready(idle), typed("see @no")).effects).not.toContainEqual(
      expect.objectContaining({ kind: "resolve-mention" }),
    );

    const narrowed = play(asked.state, typed("see @../not"));

    const stale = play(narrowed.state, {
      kind: "mention-resolved",
      query: "../no",
      cwd: "/w",
      file: outside,
    });

    expect(deriveScreen(stale.state, null).completion?.items).toEqual([]);

    const resolved = play(narrowed.state, {
      kind: "mention-resolved",
      query: "../not",
      cwd: "/w",
      file: outside,
    });

    expect(deriveScreen(resolved.state, null).completion?.items).toEqual([
      { id: "/notes/", label: "notes/", detail: "../notes/", kind: "directory" },
    ]);

    const step = play(resolved.state, {
      kind: "completion",
      action: { kind: "accept", alternate: null },
    });

    expect(step.state.local.draft.text).toBe("see [Folder notes] ");
    expect(step.state.local.draft.parts.get("[Folder notes]")).toEqual({
      kind: "file",
      path: "/notes/",
      directory: true,
    });
  });

  test("Esc dismisses the menu until the token goes away", () => {
    const closed = play(ready(idle), typed("/sett"), {
      kind: "completion",
      action: { kind: "close" },
    }).state;

    expect(deriveScreen(closed, null).completion).toBeNull();
    expect(deriveScreen(play(closed, typed("/setti")).state, null).completion).toBeNull();
    expect(
      deriveScreen(play(closed, typed(""), typed("/sett")).state, null).completion,
    ).not.toBeNull();
  });

  test("a draft starting with ! never completes", () => {
    expect(deriveScreen(play(ready(idle), typed("!ls /tm")).state, null).completion).toBeNull();
  });
});

describe("plugin commands", () => {
  const view = viewOf((v) => v.turn("t1", (t) => t.user("hi").text("ok").ended("completed")));

  const withProbe: SessionView = {
    ...view,
    catalog: {
      ...view.catalog,
      commands: [
        {
          name: "qa-probe",
          owner: "plugin",
          side: "core",
          title: "Probe",
          description: "Probe",
          arguments: null,
        },
      ],
    },
  };

  test("a typed core command runs with the delivery Enter used", () => {
    const step = play(ready(withProbe), typed("/qa-probe x"), { kind: "send", delivery: "queue" });

    expect(step.effects).toContainEqual({
      kind: "run-command",
      session: S1,
      name: "qa-probe",
      argument: "x",
      delivery: "queue",
    });
    expect(step.state.local.draft.text).toBe("");
  });

  test("a command the plugin did not know is sent as the command line", () => {
    const step = play(ready(withProbe), {
      kind: "command-unknown",
      session: S1,
      name: "qa-probe",
      argument: "x",
      delivery: "steer",
    });

    expect(step.effects).toContainEqual(
      expect.objectContaining({
        kind: "send",
        delivery: "steer",
        submission: expect.objectContaining({
          session: S1,
          snapshot: expect.objectContaining({ text: "/qa-probe x" }),
        }),
      }),
    );
  });
});

describe("paste", () => {
  test("a paste resolves through the runner and lands only for the current generation", () => {
    const state = ready(idle);

    const asked = play(state, {
      kind: "paste",
      source: { kind: "terminal", text: "hello", bytes: null },
    });

    expect(asked.effects).toEqual([
      { kind: "resolve-paste", generation: 0, text: "hello", bytes: null, cwd: "/w" },
    ]);
    expect(
      play(asked.state, {
        kind: "paste-resolved",
        generation: 0,
        insert: { kind: "text", text: "hello" },
      }).effects,
    ).toEqual([{ kind: "composer", op: { kind: "insert", text: "hello", at: "cursor" } }]);
    expect(
      play(asked.state, {
        kind: "paste-resolved",
        generation: 7,
        insert: { kind: "text", text: "x" },
      }).effects,
    ).toEqual([]);
  });

  test("a long single-line paste becomes a part, so typing after it stays cheap", () => {
    const text = "x".repeat(5_000);

    const pasted = play(ready(idle), {
      kind: "paste-resolved",
      generation: 0,
      insert: { kind: "text", text },
    });

    expect(pasted.state.local.draft.text).toBe("[Paste #1 5000 chars] ");
    expect([...pasted.state.local.draft.parts.values()]).toEqual([{ kind: "paste", text }]);
  });

  test("a pasted marker is followed by a space; the same image pasted twice goes in once", () => {
    const image = {
      kind: "image",
      bytes: new Uint8Array([1]),
      blob: null,
      mime: "image/png",
    } as const;

    const once = play(ready(idle), {
      kind: "paste-resolved",
      generation: 0,
      insert: { kind: "part", part: image },
    });

    expect(once.effects).toEqual([
      { kind: "composer", op: { kind: "insert", text: "[Image 1] ", at: "cursor" } },
    ]);
    expect(
      play(once.state, typed("[Image 1] "), {
        kind: "paste-resolved",
        generation: 0,
        insert: { kind: "part", part: image },
      }).effects,
    ).toEqual([]);
  });

  test("Enter while a paste resolves waits for it, then sends the draft with the paste", () => {
    const pasting = play(ready(idle), typed("see "), {
      kind: "paste",
      source: { kind: "terminal", text: "/tmp/a.ts", bytes: null },
    });

    const held = play(pasting.state, { kind: "send", delivery: "queue" });

    expect(held.effects).toEqual([]);
    expect(held.state.local.draft.text).toBe("see ");

    const landed = play(held.state, {
      kind: "paste-resolved",
      generation: 0,
      insert: { kind: "part", part: { kind: "file", path: "/tmp/a.ts", directory: false } },
    });

    expect(landed.effects).toContainEqual(
      expect.objectContaining({
        kind: "send",
        delivery: "queue",
        submission: expect.objectContaining({
          snapshot: expect.objectContaining({ text: "see [File a.ts] " }),
        }),
      }),
    );
  });

  test("a refused paste cancels the held send and keeps the draft", () => {
    const held = play(
      ready(idle),
      typed("keep me"),
      { kind: "paste", source: { kind: "clipboard" } },
      { kind: "send", delivery: "queue" },
      {
        kind: "paste-resolved",
        generation: 0,
        insert: { kind: "refused", reason: "Clipboard has no supported text or image." },
      },
    );

    expect(held.effects.some((effect) => effect.kind === "send")).toBe(false);
    expect(held.state.local.draft.text).toBe("keep me");
    expect(held.state.local.sendAfterPaste).toBeNull();
  });

  test("a tall paste collapses to a marker, pasting it again expands it", () => {
    const tall = Array.from({ length: 9 }, (_, index) => `line ${String(index)}`).join("\n");

    const collapsed = play(ready(idle), {
      kind: "paste-resolved",
      generation: 0,
      insert: { kind: "text", text: tall },
    });

    expect(collapsed.effects).toEqual([
      { kind: "composer", op: { kind: "insert", text: "[Paste #1 9 lines] ", at: "cursor" } },
    ]);

    const expanded = play(collapsed.state, {
      kind: "paste-resolved",
      generation: 0,
      insert: { kind: "text", text: tall },
    });

    expect(expanded.effects).toEqual([
      { kind: "composer", op: { kind: "replace-range", from: 0, to: 18, text: tall } },
    ]);
  });

  test("a paste takes the notice back, like a key", () => {
    const told = play(ready(idle), { kind: "inform", tone: "info", text: "QA plugin answered" });

    expect(told.state.local.notice?.text).toBe("QA plugin answered");
    expect(
      play(told.state, { kind: "paste", source: { kind: "terminal", text: "x", bytes: null } })
        .state.local.notice,
    ).toBeNull();
  });

  test("a refused paste says why", () => {
    expect(
      play(ready(idle), {
        kind: "paste-resolved",
        generation: 0,
        insert: { kind: "refused", reason: "Unsupported image data" },
      }).state.local.notice?.text,
    ).toBe("Unsupported image data");
  });
});

describe("failures release what they held", () => {
  test("a failed follow ends the switch, so the composer is not blocked forever", () => {
    const switching = play(ready(idle), {
      kind: "switch-session",
      session: "new",
      announce: false,
    }).state;

    expect(deriveScreen(switching, null).blocked).toEqual({ kind: "switching" });

    const failed = play(switching, { kind: "effect-failed", effect: "follow", message: "no host" });

    expect(failed.state.local.pending).toEqual([]);
    expect(failed.state.local.notice).toMatchObject({ tone: "error", text: "error: no host" });
  });
});

describe("session and view intents", () => {
  test("`!cmd` clears the draft, starts the shell in the workspace and returns to the latest output", () => {
    expect(
      play(ready(idle), typed("!ls"), { kind: "run-shell", command: "ls", include: true }).effects,
    ).toEqual([
      { kind: "composer", op: { kind: "clear" } },
      {
        kind: "shell-start",
        id: "shell-1",
        session: S1,
        command: "ls",
        include: true,
        cwd: "/w",
      },
      { kind: "scroll", op: { kind: "latest" } },
    ]);
  });

  test("Shift+Tab steps the thinking level within the model's levels, Ctrl+P cycles models with a notice", () => {
    const thinking = play(ready(idle), { kind: "cycle-thinking" });

    expect(thinking.effects).toEqual([
      { kind: "configure", session: S1, selection: { effort: "high" } },
    ]);
    expect(thinking.state.facts.session?.selection.effort).toBe("high");

    const model = play(ready(idle), { kind: "cycle-model", direction: 1 });

    expect(model.effects).toEqual([
      {
        kind: "configure",
        session: S1,
        selection: { model: { provider: "test", id: "other" }, effort: "off", fast: false },
      },
    ]);
    expect(model.state.local.notice?.text).toBe("Model: test/other · off");
  });

  test("/cd waits for the run and for the queue; switching to the current chat says so", () => {
    expect(
      play(ready(queued), { kind: "change-directory", path: "/x" }).state.local.notice?.text,
    ).toBe("Wait for the current run before changing directories");
    expect(play(ready(idle), { kind: "change-directory", path: "/x" }).effects).toEqual([
      { kind: "change-directory", session: S1, path: "/x" },
    ]);
    expect(
      play(ready(idle), { kind: "switch-session", session: S1, announce: true }).state.local.notice
        ?.text,
    ).toBe("Already in s1");
  });

  test("compact waits for the run", () => {
    expect(play(ready(queued), { kind: "compact", instructions: null }).effects).toEqual([]);
    expect(play(ready(idle), { kind: "compact", instructions: null }).effects).toEqual([
      { kind: "compact", session: S1, instructions: null },
    ]);
  });

  test("the editor blocks the composer until it closes with the new text", () => {
    const opened = play(ready(idle), typed("draft"), { kind: "open-editor" });

    expect(opened.effects).toEqual([{ kind: "open-editor", text: "draft", command: null }]);

    const closed = play(opened.state, { kind: "editor-closed", text: "edited" });

    expect(closed.effects).toEqual([
      { kind: "composer", op: { kind: "set", draft: { text: "edited", parts: new Map() } } },
    ]);
    expect(deriveScreen(closed.state, null).blocked).toBeNull();
  });

  test("Ctrl+Space expands a paste marker in place and toggles a file's preview", () => {
    const tall = Array.from({ length: 9 }, () => "x").join("\n");

    const pasted = play(ready(idle), {
      kind: "paste-resolved",
      generation: 0,
      insert: { kind: "text", text: tall },
    }).state;

    expect(play(pasted, { kind: "open-attachment" }).effects).toEqual([
      { kind: "composer", op: { kind: "replace-range", from: 0, to: 18, text: tall } },
    ]);

    const file = play(ready(idle), {
      kind: "paste-resolved",
      generation: 0,
      insert: { kind: "part", part: { kind: "file", path: "/w/a.ts", directory: false } },
    }).state;

    expect(play(file, { kind: "open-attachment" }).state.local.preview).toBe("[File a.ts]");
  });

  test("a file's preview reads its body once, shows it, closes on a click and with its marker", () => {
    const file = play(ready(idle), {
      kind: "paste-resolved",
      generation: 0,
      insert: { kind: "part", part: { kind: "file", path: "/w/a.ts", directory: false } },
    }).state;

    const opened = play(file, { kind: "open-attachment" });

    expect(opened.effects).toEqual([
      { kind: "read-preview", marker: "[File a.ts]", path: "/w/a.ts" },
    ]);
    expect(deriveScreen(opened.state, null).markers).toEqual([
      { marker: "[File a.ts]", from: 0, to: 11 },
    ]);

    const loaded = play(opened.state, {
      kind: "preview-loaded",
      marker: "[File a.ts]",
      path: "/w/a.ts",
      body: "export {};",
    }).state;

    expect(deriveScreen(loaded, null).preview).toEqual({
      marker: "[File a.ts]",
      part: { kind: "file", path: "/w/a.ts", directory: false, body: "export {};" },
    });

    const reopened = play(play(loaded, { kind: "close-preview" }).state, {
      kind: "open-attachment",
    });

    expect(reopened.effects).toEqual([]);
    expect(deriveScreen(reopened.state, null).preview?.marker).toBe("[File a.ts]");
    expect(deriveScreen(play(reopened.state, typed("")).state, null).preview).toBeNull();
  });

  test("a paste over the transcript focuses the composer", () => {
    expect(play(ready(idle), { kind: "focus-composer" }).effects).toEqual([
      { kind: "composer", op: { kind: "focus" } },
    ]);
  });

  test("Ctrl+End follows the latest again; revealing earlier keeps the viewport", () => {
    const many = viewOf((v) => {
      let built = v;

      for (let index = 0; index < 30; index += 1)
        built = built.turn(`t${String(index)}`, (t) => t.user("q").text("a").ended("completed"));

      return built;
    });

    const away = play(ready(many), { kind: "scrolled", atBottom: false });

    expect(away.state.local.transcript).toMatchObject({
      following: false,
      window: { kind: "from", index: 10 },
    });

    const revealed = play(away.state, { kind: "reveal-earlier" });

    expect(revealed.effects).toEqual([{ kind: "scroll", op: { kind: "keep-viewport" } }]);
    expect(deriveScreen(revealed.state, null).transcript.window.start).toBe(0);
    expect(
      play(revealed.state, { kind: "scroll", to: "latest" }).state.local.transcript.window,
    ).toEqual({ kind: "tail" });
  });

  test("Ctrl+O toggles tool output for every card and says so", () => {
    const toggled = play(ready(idle), { kind: "toggle-tool-output" });

    expect(toggled.state.local.transcript.toolOutput).toBe("expanded");
    expect(toggled.state.local.notice?.text).toBe("Output expanded");
  });

  test("a finished job cannot be stopped", () => {
    const task: Task = {
      kind: "job",
      id: "j1",
      job: {
        id: asId("j1"),
        title: "build",
        command: "make",
        session: S1,
        pty: null,
        state: { kind: "exited", reason: "exited", code: 0 },
        tail: "",
        startedAt: 1,
        endedAt: 2,
      },
    };

    const state = play(ready(idle), { kind: "tasks", session: S1, tasks: [task] }).state;

    expect(play(state, { kind: "stop-task", task: "j1" }).state.local.notice?.text).toBe(
      "This task has already finished. /tasks opens its output.",
    );
  });
});

describe("refusals", () => {
  test("/cd without a path says one is required", () => {
    const step = play(ready(idle), typed("/cd "), { kind: "send", delivery: "queue" });

    expect(step.state.local.notice).toMatchObject({
      tone: "error",
      text: "error: Directory is required. Use /cd <path>.",
    });
    expect(step.state.local.draft.text).toBe("/cd ");
  });
});
