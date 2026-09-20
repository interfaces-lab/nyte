import { useLayoutEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import "@nyte-ai/ui/platform-tokens.css";
import "../theme/tokens.css";
import "../theme/global.css";
import { WorkGroupView } from "./tool-group.tsx";
import { IDLE } from "../live-fold.ts";
import type { LiveSnapshot } from "../live-fold.ts";
import type { WorkTurnPart } from "./transcript-presentation.ts";
import { FOLLOW_RESUME_MS } from "./tool-group-follow.ts";
import { WorkGroupWindow, opensWorkGroup } from "./work-group-window.tsx";
import { createWorkGroupEntries } from "./work-group-entries.ts";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const entries = createWorkGroupEntries<{ readonly key: string }>()(
  Array.from({ length: 10_000 }, (_, index) => ({ key: String(index) })),
  [],
);
let mounts = 0;
function Row({ id }: { id: string }) {
  useLayoutEffect(() => {
    mounts += 1;
  }, []);
  return <input data-row={id} defaultValue="" style={{ height: 24, boxSizing: "border-box" }} />;
}

function Group({ preview }: { preview: boolean }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (preview && viewportRef.current !== null)
      viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
  }, [preview]);
  return (
    <div
      ref={viewportRef}
      id="preview"
      style={{ maxHeight: preview ? 120 : undefined, overflowY: preview ? "auto" : undefined }}
    >
      <WorkGroupWindow
        groupKey="window-test"
        density="compact"
        entries={entries}
        viewportRef={viewportRef}
        preview={preview}
        renderEntry={(entry) => <Row id={entry.key} />}
      />
    </div>
  );
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
async function settle() {
  for (let index = 0; index < 12; index += 1) await frame();
}

export async function run() {
  const outer = document.createElement("div");
  outer.dataset.nyteScrollport = "balanced";
  outer.style.cssText = "height:400px;overflow:auto;position:relative";
  document.body.append(outer);
  const root = createRoot(outer);
  const render = (preview: boolean) =>
    flushSync(() =>
      root.render(
        <>
          <div style={{ height: 200 }} />
          <Group preview={preview} />
          <div style={{ height: 500 }} />
        </>,
      ),
    );
  const row = (id: string) => outer.querySelector(`[data-row="${id}"]`);
  try {
    render(true);
    await settle();
    check(outer.querySelectorAll("input").length < 50, "Large preview only mounts a window");
    const newest = row("9999");
    if (!(newest instanceof HTMLInputElement)) throw new Error("Preview follows the newest row");
    newest.focus();
    newest.value = "selected content";
    newest.setSelectionRange(2, 6);
    check(!opensWorkGroup(newest, ""), "Tool controls do not also expand the group");
    check(!opensWorkGroup(outer, "selected text"), "Text selection does not expand the group");
    check(opensWorkGroup(outer, ""), "Background click still opens the group");
    const initialMounts = mounts;
    for (let cycle = 0; cycle < 3; cycle += 1) {
      render(false);
      await settle();
      check(
        row("9999") === newest,
        "Expansion preserves the preview row DOM and component identity",
      );
      check(
        document.activeElement === newest && newest.selectionStart === 2,
        "Expansion preserves focus and selection",
      );
      check(outer.querySelectorAll("input").length < 50, "Expansion must not mount the full group");
      render(true);
      await settle();
      check(row("9999") === newest, "Return to preview preserves the newest row identity");
    }
    check(mounts - initialMounts < 100, "Mode switches must not process thousands of heavy rows");
    render(false);
    await settle();
    outer.scrollTop = 0;
    await settle();
    check(row("0") !== null, "Expanded work is accessible through the outer transcript scrollport");
    outer.scrollTop = outer.scrollHeight;
    await settle();
    check(row("9999") !== null, "Expanded work exposes the end, not a capped inner list");
    const parts: WorkTurnPart[] = Array.from({ length: 1_000 }, (_, index) => ({
      kind: "thinking",
      commit: String(index),
      contentIndex: 0,
      text: `Work ${String(index)}`,
    }));
    flushSync(() =>
      root.render(
        <WorkGroupView
          parts={parts}
          runId={undefined}
          liveTools={new Map()}
          cwd={undefined}
          durationMs={0}
          running
          density="compact"
        />,
      ),
    );
    await settle();
    const lastParagraph = () =>
      Array.from(outer.querySelectorAll("p")).find((node) => node.textContent === "Work 999");
    const paragraph = lastParagraph();
    check(paragraph !== undefined, "The actual running group follows its newest output");
    const toggle = outer.querySelector("button");
    if (!(toggle instanceof HTMLButtonElement)) throw new Error("Missing group disclosure");
    toggle.click();
    await settle();
    check(
      lastParagraph() === paragraph,
      `The actual group keeps preview rows when opened, connected=${paragraph?.isConnected}, range=${outer.querySelector("p")?.textContent}..${Array.from(outer.querySelectorAll("p")).at(-1)?.textContent}, outer=${outer.scrollTop}/${outer.scrollHeight}`,
    );
    check(
      outer.querySelectorAll("p").length < 50,
      "The actual group does not eagerly render all prose",
    );
    check(
      outer.querySelector("[data-nyte-scrollport]") === null,
      "Opened group uses transcript scrolling",
    );
    await new Promise<void>((resolve) => window.setTimeout(resolve, FOLLOW_RESUME_MS + 250));
    await settle();
    check(
      outer.querySelector("[data-nyte-scrollport]") !== null,
      "Quiet spell restores preview follow",
    );
    check(lastParagraph() === paragraph, "Quiet-spell folding does not remount the newest prose");

    const firstThought: WorkTurnPart = {
      kind: "thinking",
      commit: "thought-0",
      contentIndex: 0,
      text: "First thought",
    };
    const settledThought: WorkTurnPart = {
      kind: "thinking",
      commit: "thought-1",
      contentIndex: 0,
      text: "Streaming thought",
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
    flushSync(() =>
      root.render(
        <WorkGroupView
          parts={[firstThought]}
          runId="run"
          liveTools={new Map()}
          cwd={undefined}
          durationMs={0}
          running={false}
          density="detailed"
        />,
      ),
    );
    await settle();
    flushSync(() =>
      root.render(
        <WorkGroupView
          parts={[firstThought]}
          runId="run"
          live={streaming}
          liveTools={streaming.tools}
          cwd={undefined}
          durationMs={0}
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
        <WorkGroupView
          parts={[firstThought, settledThought]}
          runId="run"
          liveTools={new Map()}
          cwd={undefined}
          durationMs={0}
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
    return "passed";
  } finally {
    flushSync(() => root.unmount());
    outer.remove();
  }
}
