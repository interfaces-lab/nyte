import type { SessionInfo, SessionView } from "@nyte-ai/sdk";
import { BoxRenderable, RGBA } from "@opentui/core";
import { describe, expect, test } from "bun:test";
import type { Task } from "../../../src/lib/tasks.ts";
import { DARK_THEME } from "../../../src/lib/theme.ts";
import { NO_PARTS } from "../../../src/model/draft.ts";
import type { Msg } from "../../../src/model/msg.ts";
import { Composer } from "../../../src/ui/composer/composer.tsx";
import { followed, viewOf } from "../../fixture/view.ts";
import { play, ready, S1 } from "../../model/support.ts";
import { mount } from "../chrome/support.tsx";

const idle = viewOf((v) => v.turn("t1", (t) => t.user("hi").text("ok").ended("completed")));

function child(view: SessionView): Task {
  const info: SessionInfo = { ...followed(view, "c1").info, parent: S1 };

  return { kind: "agent", id: info.id, info, view };
}

function drafts(msgs: readonly Msg[]): readonly Msg[] {
  return msgs.filter((msg) => msg.kind === "draft-changed");
}

describe("composer", () => {
  test("typing reports the draft; a paste becomes a message", async () => {
    await using app = await mount(ready(idle), () => <Composer markers={[]} />);

    await app.mockInput.typeText("hi");
    expect(drafts(app.dispatched).at(-1)).toEqual({
      kind: "draft-changed",
      text: "hi",
      cursor: 2,
      row: "only",
    });

    await app.mockInput.pasteBracketedText("pasted");
    expect(app.dispatched).toContainEqual({
      kind: "paste",
      source: { kind: "terminal", text: "pasted", bytes: null },
    });
    expect(drafts(app.dispatched).at(-1)).toMatchObject({ text: "hi" });
  });

  test("the placeholder names whose question the composer answers", async () => {
    const asking = viewOf((v) =>
      v
        .turn("c", (t) => t.user("go"))
        .question(
          [
            {
              question: "Which file?",
              header: "Question",
              options: [
                { label: "a", description: "" },
                { label: "b", description: "" },
              ],
            },
          ],
          { id: "q9" },
        )
        .waiting("q9"),
    );

    const state = play(
      ready(idle),
      { kind: "tasks", session: S1, tasks: [child(asking)] },
      { kind: "dialog", command: { kind: "close" } },
    ).state;

    await using app = await mount(state, () => <Composer markers={[]} />);

    expect(app.captureCharFrame()).toContain("Answer subagent c1, or press Enter to pick one");
  });

  test("markers draw as attachment extmarks", async () => {
    const text = "see [File a.ts] now";
    const [before = ""] = text.split("[File");
    const from = before.length;
    const marker = "[File a.ts]";

    await using app = await mount(ready(idle), () => (
      <Composer markers={[{ marker, from, to: from + marker.length }]} />
    ));

    app.composer().set({ text, parts: NO_PARTS });
    await app.renderOnce();

    const line = app
      .captureSpans()
      .lines.find((candidate) => candidate.spans.some((span) => span.text.includes("see")));

    const marked = line?.spans.find((span) => span.text.includes("[File a.ts]"));
    const plain = line?.spans.find((span) => span.text.includes("see"));

    expect(marked?.bg.equals(RGBA.fromHex(DARK_THEME.pasteBackground))).toBe(true);
    expect(plain?.text.includes("[File")).toBe(false);
  });

  test("the frame dims while the terminal is out of focus", async () => {
    await using app = await mount(ready(idle), () => <Composer markers={[]} />);
    const input = app.renderer.root.findDescendantById("input");

    const border = (): string | undefined => {
      const box = app.renderer.root.findDescendantById("input-box");

      return box instanceof BoxRenderable ? box.borderColor.toString() : undefined;
    };

    expect(input?.focused).toBe(true);
    const lit = border();

    app.renderer.emit("blur");
    await app.renderOnce();
    expect(input?.focused).toBe(false);
    expect(border()).not.toBe(lit);

    app.renderer.emit("focus");
    await app.renderOnce();
    expect(input?.focused).toBe(true);
    expect(border()).toBe(lit);
  });

  test("the port edits the textarea and the edit is reported", async () => {
    await using app = await mount(ready(idle), () => <Composer markers={[]} />);
    const port = app.composer();

    port.set({ text: "hello world", parts: NO_PARTS });
    await app.renderOnce();
    expect(drafts(app.dispatched).at(-1)).toMatchObject({ text: "hello world", cursor: 11 });

    port.replaceRange(0, 5, "howdy");
    await app.renderOnce();
    expect(drafts(app.dispatched).at(-1)).toMatchObject({ text: "howdy world", cursor: 5 });

    port.cursor("start");
    await app.renderOnce();
    expect(drafts(app.dispatched).at(-1)).toMatchObject({ text: "howdy world", cursor: 0 });

    port.insert("> ", "start");
    await app.renderOnce();
    expect(drafts(app.dispatched).at(-1)).toMatchObject({ text: "> howdy world" });

    port.clear();
    await app.renderOnce();
    expect(drafts(app.dispatched).at(-1)).toMatchObject({ text: "", cursor: 0 });
  });
});
