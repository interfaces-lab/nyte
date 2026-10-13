/** Tool cards drawn from the card model: running, settled ok, failed, stopped with a custom label. */
import { describe, expect, test } from "bun:test";
import type { Message, SessionView } from "@nyte-ai/sdk";
import type { App } from "../../../src/app/context.tsx";
import { GLYPHS } from "../../../src/lib/constants.ts";
import { isToolMessage } from "../../../src/lib/view-helpers.ts";
import { Transcript } from "../../../src/ui/transcript/transcript.tsx";
import { stateOf } from "../../fixture/state.ts";
import { followed, viewOf } from "../../fixture/view.ts";
import { renderWithApp } from "./harness.tsx";

function transcript(app: App) {
  return (
    <Transcript
      model={() => app.screen().transcript}
      attach={() => () => undefined}
      onScrolled={() => undefined}
      onRevealEarlier={() => undefined}
      onLatest={() => undefined}
    />
  );
}

function stopped(view: SessionView): SessionView {
  const messages: Message[] = view.messages.map((message) =>
    isToolMessage(message)
      ? {
          ...message,
          state: {
            ...message.state,
            phase: "settled",
            outcome: { kind: "stopped" },
            changes: null,
          },
        }
      : message,
  );

  return { ...view, messages };
}

describe("tool card", () => {
  test("running", async () => {
    const view = viewOf((v) =>
      v.turn("t1", (t) => t.user("go").tool("search", { running: true })).live(),
    );

    await using app = await renderWithApp(stateOf(followed(view)), transcript);

    expect(app.captureCharFrame()).toContain(`${GLYPHS.bullet} search`);
  });

  test("settled ok with a preview body", async () => {
    const view = viewOf((v) =>
      v.turn("t1", (t) =>
        t.user("go").tool("search", { output: "one\ntwo\nthree" }).ended("completed"),
      ),
    );

    await using app = await renderWithApp(stateOf(followed(view)), transcript);
    const frame = app.captureCharFrame();

    expect(frame).toContain(`${GLYPHS.check} search  3 lines`);
    expect(frame).toContain("two");
  });

  test("failed", async () => {
    const view = viewOf((v) =>
      v.turn("t1", (t) => t.user("go").tool("search", { failed: "boom" }).ended("failed")),
    );

    await using app = await renderWithApp(stateOf(followed(view)), transcript);

    expect(app.captureCharFrame()).toContain(`${GLYPHS.cross} search  boom · failed`);
  });

  test("stopped keeps the custom label", async () => {
    const view = viewOf((v) =>
      v.turn("t1", (t) => t.user("go").tool("Search docs", {}).ended("stopped")),
    );

    await using app = await renderWithApp(stateOf(followed(stopped(view))), transcript);

    expect(app.captureCharFrame()).toContain(`${GLYPHS.cross} Search docs  stopped`);
  });

  test("ctrl+o expands every card", async () => {
    const view = viewOf((v) =>
      v.turn("t1", (t) =>
        t.user("go").tool("search", { output: "1\n2\n3\n4\n5\n6\n7\n8" }).ended("completed"),
      ),
    );

    const state = stateOf(followed(view));
    await using app = await renderWithApp(state, transcript);

    expect(app.captureCharFrame()).toContain("… 2 more lines · ctrl+o expand");
    app.setState({
      ...state,
      local: { ...state.local, transcript: { ...state.local.transcript, toolOutput: "expanded" } },
    });
    await app.renderOnce();
    expect(app.captureCharFrame()).not.toContain("more lines");
    expect(app.captureCharFrame()).toContain("5");
  });
});
