import "../../test/window-bridge.ts";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { asId } from "@nyte-ai/schema";
import { applyDisplayMode } from "@nyte-ai/ui/appearance";
import type { ReactNode } from "react";
import { useLayoutEffect, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { PaneControllerProvider } from "../layout/pane-context.tsx";
import { PaneController } from "../layout/pane-controller.ts";
import { keys, queryClient } from "../queries.ts";
import { TranscriptContent, TranscriptProvider } from "./transcript.tsx";
import type { RowLayout } from "./transcript-rows.ts";
import { UserMessageView } from "./turn-view.tsx";
import "../theme/tokens.stylex.ts";
import "../theme/global.css";

const SESSION = asId<"session">("transcript-frames");

const HEIGHTS = [34, 220, 68, 120, 420];

const PROMPT = "Keep the pinned prompt still while its editor opens.";

const REFLOW_SESSION = asId<"session">("transcript-reflow");

const FOLLOW_SESSION = asId<"session">("transcript-follow");

type SizedRow = RowLayout & { readonly height: number; readonly label: string };

function GrowingReply({
  initialHeight,
  label,
  onReady,
}: {
  readonly initialHeight: number;
  readonly label: string;
  readonly onReady: (grow: (height: number) => void) => void;
}) {
  const [height, setHeight] = useState(initialHeight);
  useLayoutEffect(() => onReady(setHeight), [onReady]);

  return (
    <div data-follow-row data-growing-reply style={{ height, overflow: "hidden" }}>
      {label}
    </div>
  );
}

const REFLOW_PARAGRAPH = "A long paragraph must wrap as the conversation gets narrower. ".repeat(
  18,
);

const REFLOW_PARAGRAPHS = Array.from({ length: 60 }, (_, index) => ({
  key: String(index),
  text: `Paragraph ${String(index + 1)}. ${REFLOW_PARAGRAPH}`,
}));

const reflowTail: readonly RowLayout[] = Array.from({ length: 4 }, (_, index) => ({
  key: `tall:${String(index)}`,
  group: null,
  leads: true,
  sticky: false,
}));

const reflowHistory: readonly RowLayout[] = Array.from({ length: 80 }, (_, index) => ({
  key: `compact:${String(index)}`,
  group: null,
  leads: true,
  sticky: false,
}));

function estimateReflowRow(): number {
  return REFLOW_PARAGRAPHS.reduce((length, paragraph) => length + paragraph.text.length, 0) / 4;
}

const rows: readonly RowLayout[] = Array.from({ length: 400 }, (_, index) => ({
  key: `frame:${String(index)}`,
  group: `turn:${String(Math.floor(index / 20))}`,
  leads: index % 20 === 0,
  sticky: index % 20 === 0,
}));

function height(index: number): number {
  return index % 20 === 0 ? 48 : (HEIGHTS[index % HEIGHTS.length] ?? 100);
}

function painted(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

async function capture(name: string): Promise<void> {
  const captured = new Promise((resolve) =>
    document.addEventListener("renderer-captured", resolve, { once: true }),
  );

  window.rendererCapture(name);
  await captured;
}

function readFrame(viewport: HTMLElement) {
  const box = viewport.getBoundingClientRect();
  const top = box.top + 80;
  const bottom = box.bottom - 128;

  const visible = [...viewport.querySelectorAll<HTMLElement>("[data-row-key]")]
    .flatMap((row) => {
      const bounds = row.getBoundingClientRect();

      return bounds.bottom > top && bounds.top < bottom
        ? [{ key: row.dataset.rowKey, box: bounds }]
        : [];
    })
    .toSorted((first, second) => first.box.top - second.box.top);

  let edge = top;
  let gap = 0;
  let overlap = 0;
  let previousBottom: number | undefined;

  for (const row of visible) {
    gap = Math.max(gap, row.box.top - edge);
    if (previousBottom !== undefined) overlap = Math.max(overlap, previousBottom - row.box.top);
    previousBottom = row.box.bottom;
    edge = Math.max(edge, row.box.bottom);
  }

  return {
    gap: Math.max(gap, bottom - edge),
    overlap,
    offset: viewport.scrollTop,
    rows: visible.map((row) => row.key),
  };
}

function beforePaint(action: () => void, observe: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    requestAnimationFrame(() => {
      try {
        action();
      } catch (error) {
        reject(error);
      }
    });
    requestAnimationFrame(() => {
      queueMicrotask(() => {
        try {
          observe();
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  });
}

export async function run(): Promise<string> {
  const mode = document.documentElement.dataset.frameScheme === "dark" ? "dark" : "light";
  applyDisplayMode(mode);
  const foreground = mode === "dark" ? "#eee" : "#111";
  const background = mode === "dark" ? "#111" : "#fff";
  document.body.style.backgroundColor = background;
  queryClient.clear();
  queryClient.setQueryData(keys.mentionFiles, []);
  const container = document.createElement("div");
  container.style.cssText = `display:flex;width:760px;height:540px;color:${foreground};background:${background}`;
  document.body.append(container);
  const controller = new PaneController({ storageKey: "transcript-frames" });
  controller.selectSession(SESSION);
  const root = createRoot(container);

  const render = (children: ReactNode): void =>
    flushSync(() =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <TooltipProvider delay={0} closeDelay={0} timeout={0}>
            <PaneControllerProvider controller={controller}>{children}</PaneControllerProvider>
          </TooltipProvider>
        </QueryClientProvider>,
      ),
    );

  render(
    <TranscriptProvider paneId="primary" sessionId={SESSION}>
      <TranscriptContent
        rows={rows}
        ready
        estimateSize={(index) => height(index) + (index % 20 === 0 ? 14 : 8)}
        renderRow={(index) =>
          index === 380 ? (
            <UserMessageView content={PROMPT} onEdit={async () => undefined} />
          ) : index % 20 === 0 ? (
            <div
              data-sticky-user-message
              style={{ position: "sticky", top: 0, height: 48, color: foreground }}
            >
              Prompt {String(index / 20)}
            </div>
          ) : (
            <div
              data-frame-response
              style={{
                height: height(index),
                color: foreground,
                overflow: "hidden",
                whiteSpace: "pre-wrap",
              }}
            >
              {`Response ${String(index)}\n`.repeat(Math.ceil(height(index) / 20))}
            </div>
          )
        }
      />
    </TranscriptProvider>,
  );

  try {
    for (let frame = 0; frame < 10; frame += 1) await painted();
    const viewport = container.querySelector<HTMLElement>("[aria-label='Messages']");

    if (viewport === null) throw new Error("Missing transcript viewport");
    const response = viewport.querySelector<HTMLElement>("[data-frame-response]");

    if (response === null || !response.textContent?.startsWith("Response "))
      throw new Error("Missing response text");
    const ink = getComputedStyle(response);
    const paper = getComputedStyle(container).backgroundColor;

    if (
      ink.color === paper ||
      ink.color === "rgba(0, 0, 0, 0)" ||
      ink.opacity === "0" ||
      ink.visibility !== "visible"
    )
      throw new Error(`Response text is invisible: ${ink.color} on ${paper}`);
    const failures: string[] = [];

    for (let frame = 0; frame < 36; frame += 1) {
      const failed = failures.length;
      await beforePaint(
        () => {
          const delta = frame < 18 ? -1150 : 1150;
          viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: delta, bubbles: true }));
          viewport.scrollTop += delta;
          viewport.dispatchEvent(new Event("scroll"));
        },
        () => {
          const sample = readFrame(viewport);

          if (sample.gap > 1)
            failures.push(`scroll frame ${String(frame)}: ${JSON.stringify(sample)}`);
        },
      );

      if (failed === 0 && failures.length > 0) await capture("transcript-scroll-failure");
      await painted();
    }

    viewport.scrollTop = viewport.scrollHeight;
    await painted();
    await painted();

    const prompt = viewport.querySelector<HTMLElement>(
      "[data-row-key='frame:380'] [data-sticky-user-message]",
    );

    const edit = prompt?.querySelector<HTMLButtonElement>("button");

    if (prompt === null || edit === null || edit === undefined)
      throw new Error("Missing pinned prompt edit control");
    const top = prompt.getBoundingClientRect().top;

    if (Math.abs(top - viewport.getBoundingClientRect().top) > 2)
      throw new Error("The edit target is not pinned");

    await beforePaint(
      () => edit.click(),
      () => {
        if (Math.abs(prompt.getBoundingClientRect().top - top) > 1)
          failures.push("Opening the pinned editor moved its top");
      },
    );
    await painted();
    const editor = prompt.querySelector<HTMLElement>("[contenteditable='true']");

    if (editor === null || editor.textContent !== PROMPT || document.activeElement !== editor)
      throw new Error("The editor did not open focused with the prompt text");

    for (const character of " typed") {
      await beforePaint(
        () => {
          document.execCommand("insertText", false, character);
        },
        () => {
          if (Math.abs(prompt.getBoundingClientRect().top - top) > 1)
            failures.push("Typing moved the pinned editor");
        },
      );
      await painted();
    }

    const typedEditor = prompt.querySelector<HTMLElement>("[contenteditable='true']");

    if (
      typedEditor !== editor ||
      typedEditor.textContent !== `${PROMPT} typed` ||
      document.activeElement !== typedEditor
    )
      failures.push("Typing lost text or editor focus");
    await capture("transcript-pinned-editor");
    await beforePaint(
      () =>
        editor.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            keyCode: 27,
            bubbles: true,
            cancelable: true,
          }),
        ),
      () => {
        if (Math.abs(prompt.getBoundingClientRect().top - top) > 1)
          failures.push("Cancelling moved the pinned prompt");
      },
    );
    await painted();

    if (
      prompt.querySelector("[contenteditable='true']") !== null ||
      !prompt.textContent?.includes(PROMPT)
    )
      failures.push("Cancel did not restore the prompt");

    const followingHistory: readonly SizedRow[] = Array.from({ length: 20 }, (_, index) => ({
      key: `following-history:${String(index)}`,
      group: null,
      leads: true,
      sticky: false,
      height: 60 + (index % 3) * 36,
      label: `Earlier conversation ${String(index + 1)}`,
    }));

    const turnRows = (turn: number, height: number): readonly SizedRow[] =>
      [
        { key: `prompt:following-${String(turn)}`, height: 56, label: `User turn ${String(turn)}` },
        { key: `response:following-${String(turn)}`, height, label: `Response ${String(turn)}` },
        { key: `changes:following-${String(turn)}`, height: 180, label: "Latest turn summary" },
      ].map((row) => ({ ...row, group: null, leads: true, sticky: false }));

    let growResponse: (height: number) => void = () => {
      throw new Error("The current reply has not mounted");
    };

    const renderFollowing = (entries: readonly SizedRow[], growingKey?: string): void =>
      render(
        <TranscriptProvider key="following" paneId="primary" sessionId={FOLLOW_SESSION}>
          <TranscriptContent
            rows={entries}
            ready
            estimateSize={() => 24}
            renderRow={(index) => {
              const entry = entries[index];

              if (entry === undefined) return null;
              if (entry.key.startsWith("response:"))
                return (
                  <GrowingReply
                    initialHeight={entry.height}
                    label={entry.label}
                    onReady={(grow) => {
                      if (entry.key === growingKey) growResponse = grow;
                    }}
                  />
                );

              return (
                <div data-follow-row style={{ height: entry.height, overflow: "hidden" }}>
                  {entry.label}
                </div>
              );
            }}
          />
        </TranscriptProvider>,
      );

    renderFollowing([...followingHistory, ...turnRows(1, 96)]);
    for (let frame = 0; frame < 10; frame += 1) await painted();
    const followingViewport = container.querySelector<HTMLElement>("[aria-label='Messages']");

    if (followingViewport === null) throw new Error("Missing the following transcript");

    const checkFollowing = (label: string): void => {
      const distance =
        followingViewport.scrollHeight -
        followingViewport.clientHeight -
        followingViewport.scrollTop;

      if (distance > 1)
        failures.push(`${label}: following stopped ${String(distance)}px from the end`);
    };

    checkFollowing("before the next turn");
    const previousTurn = turnRows(1, 96).slice(0, -1);
    renderFollowing(
      [...followingHistory, ...previousTurn, ...turnRows(2, 56)],
      "response:following-2",
    );
    await painted();
    checkFollowing("after the next turn arrives");

    for (const height of [56, 168, 336, 480]) {
      growResponse(height);
      await painted();
      const reply = followingViewport.querySelector<HTMLElement>(
        "[data-row-key='response:following-2'] [data-growing-reply]",
      );

      if (reply?.getBoundingClientRect().height !== height)
        failures.push(
          `The following response did not reach its requested ${String(height)}px height`,
        );
      checkFollowing(`newest turn at ${String(height)}px`);
    }
    const secondTurn: readonly SizedRow[] = [
      ...turnRows(2, 480).slice(0, -1),
      {
        key: "agents:following-2",
        group: null,
        leads: true,
        sticky: false,
        height: 336,
        label: "Five agents are working",
      },
    ];
    renderFollowing(
      [...followingHistory, ...previousTurn, ...secondTurn, ...turnRows(2, 480).slice(-1)],
      "response:following-2",
    );
    await painted();
    checkFollowing("agents join before the unchanged latest summary");
    await capture("transcript-following-growth");

    const summary = followingViewport.querySelector<HTMLElement>(
      "[data-row-key='changes:following-2']",
    );

    if (summary === null) throw new Error("Missing the latest turn's summary");
    const readingStep = Math.min(
      followingViewport.clientHeight / 3,
      summary.getBoundingClientRect().height,
    );
    followingViewport.dispatchEvent(
      new WheelEvent("wheel", { deltaY: -readingStep, bubbles: true }),
    );
    followingViewport.scrollTop -= readingStep;
    followingViewport.dispatchEvent(new Event("scroll"));
    await painted();

    if (
      followingViewport.scrollHeight -
        followingViewport.clientHeight -
        followingViewport.scrollTop <=
      1
    )
      throw new Error("The reader did not leave the end of the conversation");
    const readingAnchor = [
      ...followingViewport.querySelectorAll<HTMLElement>("[data-follow-row]"),
    ].find((row) => {
      const box = row.getBoundingClientRect();
      const viewport = followingViewport.getBoundingClientRect();

      return box.bottom > viewport.top + 40 && box.top < viewport.bottom - 40;
    });

    if (readingAnchor === undefined) throw new Error("Missing the reader's visible response");
    const readingTop = readingAnchor.getBoundingClientRect().top;
    renderFollowing(
      [...followingHistory, ...previousTurn, ...secondTurn, ...turnRows(3, 56)],
      "response:following-3",
    );
    await painted();
    const readingReply = followingViewport.querySelector<HTMLElement>(
      "[data-row-key='response:following-3'] [data-growing-reply]",
    );

    if (readingReply === null) throw new Error("The response below the reader did not mount");

    for (const height of [56, 168, 336, 480]) {
      growResponse(height);
      await painted();
      const reply = followingViewport.querySelector<HTMLElement>(
        "[data-row-key='response:following-3'] [data-growing-reply]",
      );

      if (reply?.getBoundingClientRect().height !== height)
        failures.push(
          `The response below the reader did not reach its requested ${String(height)}px height`,
        );
      if (
        !readingAnchor.isConnected ||
        Math.abs(readingAnchor.getBoundingClientRect().top - readingTop) > 1
      )
        failures.push(`newest turn at ${String(height)}px moved the reader's response`);
    }
    await capture("transcript-reading-growth");

    const renderReflow = (entries: readonly RowLayout[]): void =>
      render(
        <TranscriptProvider key="reflow" paneId="primary" sessionId={REFLOW_SESSION}>
          <TranscriptContent
            rows={entries}
            ready
            estimateSize={estimateReflowRow}
            renderRow={(index) => {
              const row = entries[index];

              if (row === undefined) return null;
              const prose = REFLOW_PARAGRAPHS.map((paragraph) => (
                <p key={paragraph.key}>{paragraph.text}</p>
              ));

              return row.key.startsWith("compact:") ? (
                <Collapsible.Root>
                  <Collapsible.Trigger>{`Earlier reply ${row.key.slice(8)}`}</Collapsible.Trigger>
                  <Collapsible.Panel>{prose}</Collapsible.Panel>
                </Collapsible.Root>
              ) : (
                <div data-reflow-response>
                  {prose}
                  <Collapsible.Root>
                    <Collapsible.Trigger data-reflow-anchor>
                      {`Inspect ${row.key}`}
                    </Collapsible.Trigger>
                    <Collapsible.Panel>
                      This detail opens beneath the reader's chosen control.
                    </Collapsible.Panel>
                  </Collapsible.Root>
                </div>
              );
            }}
          />
        </TranscriptProvider>,
      );

    renderReflow(reflowTail);

    for (let frame = 0; frame < 10; frame += 1) await painted();
    const reflowViewport = container.querySelector<HTMLElement>("[aria-label='Messages']");
    const reflowAnchor = container.querySelector<HTMLElement>(
      "[data-row-key='tall:3'] [data-reflow-anchor]",
    );
    const reflowRow = reflowAnchor?.closest<HTMLElement>("[data-row-key]");

    if (
      reflowViewport === null ||
      reflowAnchor === null ||
      reflowRow === null ||
      reflowRow === undefined
    )
      throw new Error("Missing the tall response or its disclosure control");
    const beforeWidth = reflowViewport.clientWidth;
    const beforeHeight = reflowRow.getBoundingClientRect().height;
    const anchorTop = reflowAnchor.getBoundingClientRect().top;
    const anchorText = reflowAnchor.textContent;

    if (
      anchorTop < reflowViewport.getBoundingClientRect().top ||
      reflowAnchor.getBoundingClientRect().bottom > reflowViewport.getBoundingClientRect().bottom
    )
      throw new Error("The reflow disclosure is outside the viewport");
    reflowAnchor.click();

    const checkReflow = (label: string): void => {
      const sample = readFrame(reflowViewport);

      if (sample.gap > 1) failures.push(`${label}: ${JSON.stringify(sample)}`);
      if (!reflowAnchor.isConnected || reflowAnchor.textContent !== anchorText)
        failures.push(`${label}: the held disclosure was replaced`);
      const top = reflowAnchor.getBoundingClientRect().top;

      if (Math.abs(top - anchorTop) > 1)
        failures.push(
          `${label}: reflow moved the held disclosure ${JSON.stringify({
            before: anchorTop,
            top,
            scrollTop: reflowViewport.scrollTop,
            rowTop: reflowRow.getBoundingClientRect().top,
            rowHeight: reflowRow.getBoundingClientRect().height,
          })}`,
        );
    };

    for (const width of ["360px", "760px", "360px", "760px"]) {
      container.style.width = width;

      for (let frame = 0; frame < 3; frame += 1) {
        await painted();
        checkReflow(`${width} reflow frame ${String(frame)}`);
      }

      if (
        reflowViewport.clientWidth < beforeWidth &&
        reflowRow.getBoundingClientRect().height <= beforeHeight
      )
        failures.push(`${width}: the tall prose did not actually rewrap`);
    }

    renderReflow([...reflowHistory, ...reflowTail]);

    for (let frame = 0; frame < 3; frame += 1) {
      await painted();
      checkReflow(`compact history prepended frame ${String(frame)}`);
    }
    await capture("transcript-reflow-anchor");
    reflowViewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -1_000_000, bubbles: true }));
    reflowViewport.scrollTop = 0;
    reflowViewport.dispatchEvent(new Event("scroll"));

    for (let frame = 0; frame < 10; frame += 1) {
      await painted();
      const sample = readFrame(reflowViewport);

      if (sample.gap > 1) {
        failures.push(`compact history frame ${String(frame)}: ${JSON.stringify(sample)}`);
        if (frame === 0) await capture("transcript-reflow-history-failure");
      }
    }

    const firstCompact = container.querySelector<HTMLElement>("[data-row-key='compact:0'] button");

    if (
      firstCompact?.textContent !== "Earlier reply 0" ||
      firstCompact.getBoundingClientRect().bottom <= reflowViewport.getBoundingClientRect().top ||
      firstCompact.getBoundingClientRect().top >= reflowViewport.getBoundingClientRect().bottom
    )
      failures.push("The first compact reply did not become visible after scrolling to history");
    await capture("transcript-reflow-history");

    const jump = (offset: number): void => {
      reflowViewport.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: offset - reflowViewport.scrollTop,
          bubbles: true,
        }),
      );
      reflowViewport.scrollTop = offset;
      reflowViewport.dispatchEvent(new Event("scroll"));
    };

    const checkCachedFrames = async (label: string): Promise<void> => {
      for (let frame = 0; frame < 4; frame += 1) {
        await painted();
        const sample = readFrame(reflowViewport);

        if (sample.gap > 1 || sample.overlap > 1)
          failures.push(`${label} frame ${String(frame)}: ${JSON.stringify(sample)}`);
      }
    };

    container.style.width = "360px";
    await checkCachedFrames("narrow history with long responses unmounted");
    jump(reflowViewport.scrollHeight);
    await checkCachedFrames("return to cached responses in a narrower chat");
    const cachedRow = container.querySelector<HTMLElement>("[data-row-key='tall:1']");

    if (cachedRow === null) throw new Error("The cached response did not remount");
    const cachedHeight = cachedRow.getBoundingClientRect().height;
    const oldBottom =
      reflowViewport.scrollTop +
      cachedRow.getBoundingClientRect().bottom -
      reflowViewport.getBoundingClientRect().top;
    jump(oldBottom - reflowViewport.clientHeight / 2);
    await checkCachedFrames("read near the cached response's old bottom");
    const oldOffset = reflowViewport.scrollTop;
    jump(0);
    await checkCachedFrames("scroll away from the cached response");

    if (cachedRow.isConnected) throw new Error("The cached response did not leave the DOM");
    container.style.width = "760px";
    await checkCachedFrames("wider history with long responses unmounted");
    jump(oldOffset);
    await checkCachedFrames("return near the old bottom after widening");
    const remeasured = container.querySelector<HTMLElement>("[data-row-key='tall:1']");

    if (remeasured === null || remeasured.getBoundingClientRect().height >= cachedHeight)
      failures.push("The remounted response did not shrink after the chat widened");
    await capture("transcript-cached-reflow");
    await capture(failures.length === 0 ? "transcript-frames-passed" : "transcript-frames-failed");

    return failures.length === 0 ? "passed" : failures.join("\n");
  } catch (error) {
    await capture("transcript-frames-error");
    throw error;
  } finally {
    flushSync(() => root.unmount());
    container.remove();
    queryClient.clear();
  }
}
