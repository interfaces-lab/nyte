import "../../test/window-bridge.ts";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { ReactNode } from "react";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import "../theme/tokens.stylex.ts";
import "../theme/global.css";
import { StepGroupView } from "./step-group.tsx";
import type { StepMessage } from "./transcript-presentation.ts";
import { FOLLOW_RESUME_MS } from "./step-group-follow.ts";
import { asId } from "@nyte-ai/schema";
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

function thought(id: string, text: string, at: number, live = false): StepMessage {
  return {
    id: asId<"message">(id),
    turn: asId<"turn">("turn"),
    at,
    kind: "part",
    part: asId<"part">(id),
    partKind: "thinking",
    role: "step",
    version: 1,
    state: { markdown: text, merged: 1, signature: null },
    status: live
      ? { kind: "live", run: asId<"run">("run") }
      : { kind: "settled", commit: asId<"commit">(id), endedAt: at },
  };
}

function thoughts(count: number): StepMessage[] {
  return Array.from({ length: count }, (_, index) =>
    thought(String(index), `Work ${String(index)}`, index),
  );
}

export async function run() {
  const outer = document.createElement("div");
  outer.style.cssText = "height:400px;overflow:auto;position:relative";
  document.body.append(outer);
  const root = createRoot(outer);

  const render = (messages: readonly StepMessage[], running: boolean) =>
    flushSync(() =>
      root.render(
        <StepGroupView
          messages={messages}
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

    const firstThought = thought("thought-0", "First thought", 0);
    const streamingThought = thought("thought-1", "Streaming thought", 1, true);
    const settledThought = thought("thought-1", "Streaming thought", 1);

    const group = (messages: readonly StepMessage[], running: boolean) => (
      <StepGroupView
        messages={messages}
        cwd={undefined}
        added={0}
        removed={0}
        running={running}
        density="detailed"
      />
    );

    flushSync(() => root.render(null));
    flushSync(() => root.render(group([firstThought], false)));
    await settle();
    const thoughtToggle = outer.querySelector("button");

    if (!(thoughtToggle instanceof HTMLButtonElement))
      throw new Error("Missing thought disclosure");
    thoughtToggle.click();
    await settle();
    flushSync(() => root.render(group([firstThought, streamingThought], true)));
    await settle();

    const firstParagraph = Array.from(outer.querySelectorAll("p")).find(
      (node) => node.textContent === "First thought",
    );

    const streamedParagraph = Array.from(outer.querySelectorAll("p")).find(
      (node) => node.textContent === "Streaming thought",
    );

    check(firstParagraph !== undefined, "Earlier settled thought is visible");
    check(streamedParagraph !== undefined, "Streaming thought is visible");
    flushSync(() => root.render(group([firstThought, settledThought], false)));
    await settle();
    check(
      Array.from(outer.querySelectorAll("p")).find(
        (node) => node.textContent === "First thought",
      ) === firstParagraph,
      "Settling does not remount older reasoning",
    );
    check(
      Array.from(outer.querySelectorAll("p")).find(
        (node) => node.textContent === "Streaming thought",
      ) === streamedParagraph,
      "Settling a streamed thought preserves its row",
    );

    const transcript = (node: ReactNode) =>
      flushSync(() =>
        root.render(
          <PaneControllerProvider workspaceKey="step-group-test">
            <TranscriptProvider paneId="primary" sessionId={asId<"session">("step-group-test")}>
              {node}
            </TranscriptProvider>
          </PaneControllerProvider>,
        ),
      );

    const compact = (key: string, message: StepMessage) => (
      <StepGroupView
        key={key}
        messages={[message]}
        cwd={undefined}
        added={0}
        removed={0}
        running
        density="compact"
      />
    );

    const expandedState = () => outer.querySelector("button")?.getAttribute("aria-expanded");

    transcript(compact("live", thought("live-3", "Live thought", 0, true)));
    await settle();
    outer.querySelector("button")?.click();
    await settle();
    check(expandedState() === "true", "A live group opens");
    transcript(compact("durable", thought("live-3", "Live thought", 0)));
    await settle();
    check(expandedState() === "true", "The settled group keeps the live group open");
    transcript(compact("later", thought("live-4", "Live thought", 0, true)));
    await settle();
    check(expandedState() === "false", "A later live group starts from its density default");

    return "passed";
  } finally {
    flushSync(() => root.unmount());
    outer.remove();
  }
}

applyDisplayMode("light");
