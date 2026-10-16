import { describe, expect, test } from "bun:test";
import type { App } from "../../../src/app/context.tsx";
import { splitMermaid } from "../../../src/ui/transcript/markdown.tsx";
import { Transcript } from "../../../src/ui/transcript/transcript.tsx";
import { frameShowing } from "../../fixture/render.tsx";
import { buildState } from "../../fixture/state.ts";
import { followed, buildView } from "../../fixture/view.ts";
import { renderWithApp } from "./harness.tsx";

const TEXT = [
  "Here is the flow:",
  "```mermaid",
  "graph TD",
  "Start --> Finish",
  "```",
  "Done.",
].join("\n");

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

describe("mermaid", () => {
  test("splitMermaid keeps prose around a fence and leaves other fences in the markdown", () => {
    expect(splitMermaid(TEXT)).toEqual([
      { kind: "markdown", text: "Here is the flow:" },
      { kind: "mermaid", source: "graph TD\nStart --> Finish" },
      { kind: "markdown", text: "Done." },
    ]);

    expect(splitMermaid("a\n```ts\nx\n```\nb")).toEqual([
      { kind: "markdown", text: "a\n```ts\nx\n```\nb" },
    ]);
    expect(splitMermaid("a\n```mermaid\ngraph TD")).toEqual([
      { kind: "markdown", text: "a\n```mermaid\ngraph TD" },
    ]);
  });

  test("the diagram renders, and the toggle shows the source through a disclosure", async () => {
    const view = buildView((v) =>
      v.turn("t1", (t) => t.user("draw").text(TEXT).ended("completed")),
    );
    const state = buildState(followed(view));
    await using app = await renderWithApp(state, transcript);
    const frame = await frameShowing(app, "mermaid · click for source");

    expect(frame).toContain("mermaid · click for source");
    expect(frame).toContain("Start");
    expect(frame).toContain("Finish");
    expect(frame).not.toContain("graph TD");

    const row = frame.split("\n").findIndex((line) => line.includes("mermaid · click for source"));
    await app.mockMouse.click(4, row);

    expect(app.dispatched).toEqual([{ kind: "toggle-disclosure", key: "m2:mermaid:1" }]);

    app.setState({
      ...state,
      local: {
        ...state.local,
        transcript: { ...state.local.transcript, disclosures: new Set(["m2:mermaid:1"]) },
      },
    });
    await app.renderOnce();
    const toggled = app.captureCharFrame();

    expect(toggled).toContain("mermaid · click for diagram");
    expect(toggled).toContain("graph TD");
  });
});
