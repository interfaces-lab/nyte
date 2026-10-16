import { RGBA, ScrollBoxRenderable } from "@opentui/core";
import { describe, expect, test } from "bun:test";
import { DARK_THEME } from "../../src/lib/theme.ts";
import type { Task } from "../../src/lib/tasks.ts";
import { NO_PARTS } from "../../src/model/draft.ts";
import { Screen } from "../../src/ui/screen.tsx";
import { followed, viewOf } from "../fixture/view.ts";
import { blank, play, ready, typed } from "../model/support.ts";
import { mount } from "./chrome/support.tsx";

const empty = viewOf((v) => v);

const idle = viewOf((v) => v.turn("t1", (t) => t.user("hi").text("ok").ended("completed")));

const talked = viewOf((v) =>
  v.turn("t1", (t) => t.user("where is the tree").text("Here it is.").ended("completed")),
);

const queued = viewOf((v) =>
  v
    .turn("t1", (t) => t.user("hi").text("ok").ended("completed"))
    .pending("later please", { schedule: { kind: "next-turn", reason: "requested" } }),
);

function row(frame: string, text: string): number {
  return frame.split("\n").findIndex((line) => line.includes(text));
}

describe("screen", () => {
  test("starting shows the welcome with a spinner, and no loading line", async () => {
    await using app = await mount(blank(), () => <Screen />);
    const frame = app.captureCharFrame();

    expect(frame).toContain("Welcome to Nyte");
    expect(frame).not.toContain("for files");
    expect(frame).not.toContain("loading");
    expect(frame).not.toContain("Loading");
  });

  test("queue rows sit above the composer, the notice under its rule, the hints last", async () => {
    const state = play(ready(queued), { kind: "refuse", reason: "Nothing to stop" }).state;

    await using app = await mount(state, () => <Screen />);
    const frame = app.captureCharFrame();
    const lines = frame.split("\n");

    const prompt = row(frame, "❯");
    const rule = lines.findIndex((line) => line.includes("╰"));

    expect(row(frame, "later please")).toBeLessThan(prompt);
    expect(rule).toBeGreaterThan(prompt);
    expect(row(frame, "Nothing to stop")).toBeGreaterThan(rule);
    expect(row(frame, "enter send")).toBe(lines.findLastIndex((line) => line.trim() !== ""));
  });

  test("an empty session shows the welcome", async () => {
    await using app = await mount(ready(empty), () => <Screen />);

    expect(app.captureCharFrame()).toContain("Welcome to Nyte");
  });

  test("completion takes the slot under the composer", async () => {
    const state = play(ready(idle), typed("/")).state;

    await using app = await mount(state, () => <Screen />);
    const frame = app.captureCharFrame();

    expect(row(frame, "/cd")).toBeGreaterThan(row(frame, "╰"));
  });

  test("the highlighted completion row is a selection band; narrow menus drop the details", async () => {
    const state = play(ready(idle), typed("/")).state;

    await using wide = await mount(state, () => <Screen />);
    const lines = wide.captureCharFrame().split("\n");
    const first = lines.findIndex((line) => line.includes("❯ /"));

    expect(lines[first]).toContain("Choose a saved account");
    expect(
      wide
        .captureSpans()
        .lines[first]?.spans.find((span) => span.text.includes("/"))
        ?.bg.toString(),
    ).toBe(RGBA.fromHex(DARK_THEME.selectionBackground).toString());

    await using narrow = await mount(state, () => <Screen />, { width: 40, height: 32 });

    const highlighted = narrow
      .captureCharFrame()
      .split("\n")
      .find((line) => line.includes("❯ /"));

    expect(highlighted).toContain("/accounts");
    expect(highlighted).not.toContain("Choose a saved account");
  });

  test("an empty menu says why: no command, no file, or a listing still loading", async () => {
    for (const [draft, text] of [
      ["/zzz", "no matching commands"],
      ["see @zzz", "no matching files or folders"],
      ["/cd ", "loading directories…"],
    ] as const) {
      await using app = await mount(play(ready(idle), typed(draft)).state, () => <Screen />);

      expect(app.captureCharFrame()).toContain(text);
    }
  });

  test("the tree opens under the composer with the transcript kept, and a refusal shows above it", async () => {
    const opened = play(ready(talked), {
      kind: "open",
      dialog: { kind: "tree", filter: "default" },
    }).state;

    const state = play(opened, {
      kind: "refuse",
      reason: "Already at that point in the chat",
      tone: "info",
    }).state;

    await using app = await mount(state, () => <Screen />);
    const frame = app.captureCharFrame();
    const rule = frame.split("\n").findIndex((line) => line.includes("╰"));

    expect(row(frame, "Here it is.")).toBeLessThan(rule);
    expect(row(frame, "Already at that point in the chat")).toBeGreaterThan(rule);
    expect(row(frame, "Session Tree")).toBeGreaterThan(
      row(frame, "Already at that point in the chat"),
    );
  });

  test("a screen dialog replaces the transcript and hides the composer; the draft survives", async () => {
    const state = ready(idle);
    const child = followed(idle, "c1");

    const task: Task = {
      kind: "agent",
      id: child.id,
      info: child.info,
      view: child.view ?? undefined,
    };

    const inspecting = { ...state, facts: { ...state.facts, tasks: [task] } };

    await using app = await mount(state, () => <Screen />);
    app.composer().set({ text: "keep me", parts: NO_PARTS });
    await app.renderOnce();
    expect(app.captureCharFrame()).toContain("keep me");

    await app.show(
      play(inspecting, { kind: "open", dialog: { kind: "inspector", task: child.id } }).state,
    );
    expect(app.captureCharFrame()).not.toContain("keep me");

    await app.show(state);
    expect(app.captureCharFrame()).toContain("keep me");
  });

  test("an open attachment preview shows its body above the composer; its title closes it", async () => {
    const attached = play(ready(idle), {
      kind: "paste-resolved",
      generation: 0,
      insert: { kind: "part", part: { kind: "file", path: "/w/a.ts", directory: false } },
    }).state;

    const state = play(play(attached, { kind: "open-attachment" }).state, {
      kind: "preview-loaded",
      marker: "[File a.ts]",
      path: "/w/a.ts",
      body: "export const answer = 42;",
    }).state;

    await using app = await mount(state, () => <Screen />);
    await app.renderOnce();
    const frame = app.captureCharFrame();
    const title = row(frame, "[File a.ts] · click to close");

    expect(title).toBeGreaterThan(-1);
    expect(row(frame, "export const answer = 42;")).toBeGreaterThan(title);
    expect(row(frame, "export const answer = 42;")).toBeLessThan(row(frame, "❯"));

    await app.mockMouse.click(5, title);
    expect(app.dispatched).toContainEqual({ kind: "close-preview" });
  });

  test("a paste over the transcript goes to the composer", async () => {
    await using app = await mount(ready(idle), () => <Screen />);
    const transcript = app.renderer.root.findDescendantById("transcript");

    if (!(transcript instanceof ScrollBoxRenderable)) throw new Error("No transcript scrollbox");
    transcript.focusable = true;
    transcript.focus();
    await app.mockInput.pasteBracketedText("pasted text");

    expect(app.dispatched.slice(-2)).toEqual([
      { kind: "focus-composer" },
      { kind: "paste", source: { kind: "terminal", text: "pasted text", bytes: null } },
    ]);
  });
});
