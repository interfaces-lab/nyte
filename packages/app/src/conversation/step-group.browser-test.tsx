import "../../test/window-bridge.ts";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { ReactNode } from "react";
import { applyDisplayMode } from "../theme/appearance.ts";
import "../theme/tokens.stylex.ts";
import "../theme/global.css";
import { StepGroupView } from "./step-group.tsx";
import { IDLE } from "../live-fold.ts";
import type { LiveSnapshot } from "../live-fold.ts";
import type { StepTurnPart } from "./transcript-presentation.ts";
import { FOLLOW_RESUME_MS } from "./step-group-follow.ts";
import { sessionId } from "@nyte-ai/protocol";
import { PaneControllerProvider } from "../layout/pane-context.tsx";
import { TranscriptProvider } from "./transcript.tsx";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function settle() {
  for (let index = 0; index < 4; index += 1) await frame();
}

function thoughts(count: number): StepTurnPart[] {
  return Array.from({ length: count }, (_, index) => ({
    kind: "thinking",
    commit: String(index),
    contentIndex: 0,
    text: `Work ${String(index)}`,
    at: index,
  }));
}

export async function run() {
  const outer = document.createElement("div");
  outer.style.cssText = "height:400px;overflow:auto;position:relative";
  document.body.append(outer);
  const root = createRoot(outer);

  const render = (parts: readonly StepTurnPart[], running: boolean) =>
    flushSync(() =>
      root.render(
        <StepGroupView
          parts={parts}
          run={{ kind: "none" }}
          liveTools={new Map()}
          cwd={undefined}
          added={0}
          removed={0}
          running={running}
          density="compact"
        />,
      ),
    );

  const paragraphs = () => Array.from(outer.querySelectorAll("p"));
  const paragraph = (text: string) => paragraphs().find((node) => node.textContent === text);

  const atBottom = (element: Element) =>
    element.scrollTop + element.clientHeight >= element.scrollHeight - 1;

  try {
    render(thoughts(40), true);
    await settle();
    const preview = outer.querySelector("[data-nyte-scrollport]");

    if (!(preview instanceof HTMLElement)) throw new Error("A running group shows its preview");
    check(preview.clientHeight === 144, "The preview caps at six rows");
    check(atBottom(preview), "The preview follows its newest output");
    check(preview.hasAttribute("data-overflow"), "Overflowing previews fade their top");

    render(thoughts(41), true);
    await settle();
    check(atBottom(preview), "New output keeps the preview at the bottom");

    preview.dispatchEvent(new WheelEvent("wheel"));
    preview.scrollTop = 0;
    await settle();
    render(thoughts(42), true);
    await settle();
    check(preview.scrollTop === 0, "Scrolling up pauses following");

    preview.dispatchEvent(new WheelEvent("wheel"));
    preview.scrollTop = preview.scrollHeight;
    await settle();
    render(thoughts(43), true);
    await settle();
    check(atBottom(preview), "Returning to the bottom resumes following");

    preview.dispatchEvent(new WheelEvent("wheel"));
    preview.scrollTop = 0;
    await settle();
    await wait(FOLLOW_RESUME_MS / 2);
    preview.dispatchEvent(new WheelEvent("wheel"));
    await wait(FOLLOW_RESUME_MS / 2 + 250);
    check(preview.scrollTop === 0, "Each input while paused restarts the quiet spell");
    await wait(FOLLOW_RESUME_MS / 2);
    await settle();
    check(atBottom(preview), "A quiet spell resumes following");

    const newest = paragraph("Work 42");
    const toggle = outer.querySelector("button");

    if (!(toggle instanceof HTMLButtonElement)) throw new Error("Missing group disclosure");
    newest?.click();
    await settle();
    check(toggle.getAttribute("aria-expanded") === "true", "Clicking the preview opens the group");
    check(paragraph("Work 42") === newest, "Opening keeps the clicked row mounted");
    check(paragraphs().length === 43, "The opened group lists every step");
    check(outer.querySelector("[data-nyte-scrollport]") === null, "The opened list is not clipped");

    toggle.click();
    await settle();
    check(
      outer.querySelector("[data-nyte-scrollport]") !== null,
      "Closing the list returns the live group to its preview",
    );
    check(
      toggle.getAttribute("aria-expanded") === "false",
      "The preview does not read as expanded",
    );

    flushSync(() => root.render(null));
    render(thoughts(3), true);
    await settle();
    check(outer.querySelector("[data-nyte-scrollport]") !== null, "A fresh live group previews");
    render(thoughts(3), false);
    await settle();
    check(paragraphs().length === 0, "A settled compact group collapses");

    flushSync(() => root.render(null));
    render(thoughts(250), false);
    await settle();
    outer.querySelector("button")?.click();
    await settle();
    check(paragraphs().length === 200, "A long group opens on its newest steps");

    const earlier = Array.from(outer.querySelectorAll("button")).find(
      (button) => button.textContent === "Show 50 earlier steps",
    );

    if (earlier === undefined) throw new Error("Missing earlier steps control");
    earlier.click();
    await settle();
    check(paragraphs().length === 250, "Earlier steps reveal the whole group");
    check(
      document.activeElement !== document.body && outer.contains(document.activeElement),
      "Revealing earlier steps keeps focus in the group",
    );

    const firstThought: StepTurnPart = {
      kind: "thinking",
      commit: "thought-0",
      contentIndex: 0,
      text: "First thought",
      at: 0,
    };

    const settledThought: StepTurnPart = {
      kind: "thinking",
      commit: "thought-1",
      contentIndex: 0,
      text: "Streaming thought",
      at: 1,
    };

    const liveKey = "run:2:0";

    const streaming = {
      parts: IDLE.parts,
      runState: "working",
      text: IDLE.text,
      thinking: new Map([[liveKey, settledThought.text]]),
      tools: IDLE.tools,
      order: [{ kind: "thinking", runId: "run", attempt: 2, index: 0 }],
    } satisfies LiveSnapshot;

    flushSync(() => root.render(null));
    flushSync(() =>
      root.render(
        <StepGroupView
          parts={[firstThought]}
          run={{ kind: "run", id: "run" }}
          liveTools={new Map()}
          cwd={undefined}
          added={0}
          removed={0}
          running={false}
          density="detailed"
        />,
      ),
    );
    await settle();
    const thoughtToggle = outer.querySelector("button");

    if (!(thoughtToggle instanceof HTMLButtonElement))
      throw new Error("Missing thought disclosure");
    thoughtToggle.click();
    await settle();
    flushSync(() =>
      root.render(
        <StepGroupView
          parts={[firstThought]}
          run={{ kind: "run", id: "run" }}
          live={streaming}
          liveTools={streaming.tools}
          cwd={undefined}
          added={0}
          removed={0}
          running
          density="detailed"
        />,
      ),
    );
    await settle();

    const firstParagraph = Array.from(outer.querySelectorAll("p")).find(
      (node) => node.textContent === firstThought.text,
    );

    const streamedParagraph = Array.from(outer.querySelectorAll("p")).find(
      (node) => node.textContent === settledThought.text,
    );

    check(firstParagraph !== undefined, "Earlier settled thought is visible");
    check(streamedParagraph !== undefined, "Streaming thought is visible");
    flushSync(() =>
      root.render(
        <StepGroupView
          parts={[firstThought, settledThought]}
          run={{ kind: "run", id: "run" }}
          liveTools={new Map()}
          cwd={undefined}
          added={0}
          removed={0}
          running={false}
          density="detailed"
        />,
      ),
    );
    await settle();
    check(
      Array.from(outer.querySelectorAll("p")).find(
        (node) => node.textContent === firstThought.text,
      ) === firstParagraph,
      "A reused content index does not remount older reasoning",
    );
    check(
      Array.from(outer.querySelectorAll("p")).find(
        (node) => node.textContent === settledThought.text,
      ) === streamedParagraph,
      "Settling a streamed thought preserves its row",
    );

    const live = (index: number) =>
      ({
        ...streaming,
        thinking: new Map([[`run:1:${String(index)}`, "Live thought"]]),
        order: [{ kind: "thinking", runId: "run", attempt: 1, index }],
      }) satisfies LiveSnapshot;

    const transcript = (group: ReactNode) =>
      flushSync(() =>
        root.render(
          <PaneControllerProvider workspaceKey="step-group-test">
            <TranscriptProvider
              paneId="primary"
              sessionId={sessionId("step-group-test")}
              ready
              autoScroll
              scrollEdgeThreshold={60}
            >
              {group}
            </TranscriptProvider>
          </PaneControllerProvider>,
        ),
      );

    const liveOnly = (index: number) => (
      <StepGroupView
        key={`live:${String(index)}`}
        parts={[]}
        run={{ kind: "none" }}
        live={live(index)}
        liveTools={new Map()}
        cwd={undefined}
        added={0}
        removed={0}
        running
        density="compact"
      />
    );

    const expandedState = () => outer.querySelector("button")?.getAttribute("aria-expanded");

    transcript(liveOnly(3));
    await settle();
    outer.querySelector("button")?.click();
    await settle();
    check(expandedState() === "true", "A live-only group opens");
    transcript(
      <StepGroupView
        key="durable"
        parts={[
          { kind: "thinking", commit: "landed", contentIndex: 3, text: "Live thought", at: 0 },
        ]}
        run={{ kind: "run", id: "run" }}
        liveTools={new Map()}
        cwd={undefined}
        added={0}
        removed={0}
        running
        density="compact"
      />,
    );
    await settle();
    check(expandedState() === "true", "The landed group keeps the live group open");
    transcript(liveOnly(3));
    await settle();
    check(expandedState() === "false", "A later live group starts from its density default");

    return "passed";
  } finally {
    flushSync(() => root.unmount());
    outer.remove();
  }
}

applyDisplayMode("light");
