import { create, props } from "@stylexjs/stylex";
import type { Static } from "typebox";
import { createRoot } from "react-dom/client";
import { Prose } from "../src/chat/markdown/prose.tsx";
import { StreamingCase } from "./gates.ts";
import type { StreamingResult } from "./gates.ts";
import { nextFrame, Page, readCase, SIMD, STEP_CHARS } from "./page.tsx";
import { quantile, sum } from "./stats.ts";

const TICK_MS = 40;

const styles = create({
  row: { position: "relative", display: "flex", width: 1280 },
  column: { flexGrow: 0, flexShrink: 0, flexBasis: "50%", minWidth: 0 },
  covered: {
    position: "absolute",
    insetBlockStart: 0,
    insetInlineStart: 0,
    width: "50%",
    contentVisibility: "hidden",
  },
});

export async function run(): Promise<string> {
  const benchCase = readCase(StreamingCase);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  const draw = (markdown: string, streaming: boolean): void =>
    root.render(
      <Page>
        <div {...props(styles.row)}>
          {Array.from({ length: benchCase.streams }, (_, index) => (
            <div key={index} {...props(styles.column)}>
              <Prose markdown={markdown} streaming={streaming} />
            </div>
          ))}
          {benchCase.covered && (
            <div {...props(styles.covered)}>
              <Prose markdown={markdown} streaming={streaming} />
            </div>
          )}
        </div>
      </Page>,
    );

  const longTasks: number[] = [];

  const observer = PerformanceObserver.supportedEntryTypes.includes("longtask")
    ? new PerformanceObserver((list) => {
        longTasks.push(...list.getEntries().map((entry) => entry.duration));
      })
    : undefined;

  const intervals: number[] = [];
  let playing = true;
  let previous = await nextFrame();

  const sample = (time: number): void => {
    intervals.push(time - previous);
    previous = time;

    if (playing) requestAnimationFrame(sample);
  };

  observer?.observe({ type: "longtask" });
  requestAnimationFrame(sample);
  const started = performance.now();
  let ticks = 0;

  await new Promise<void>((resolve) => {
    const tick = (): void => {
      ticks += 1;
      const length = ticks * STEP_CHARS;
      const streaming = length < SIMD.length;
      draw(streaming ? SIMD.slice(0, length) : SIMD, streaming);

      if (!streaming) {
        resolve();

        return;
      }

      setTimeout(tick, TICK_MS);
    };

    tick();
  });

  await nextFrame();
  const playbackMs = performance.now() - started;
  playing = false;
  await nextFrame();
  observer?.disconnect();
  root.unmount();
  host.remove();

  const result: Static<typeof StreamingResult> = {
    ticks,
    playbackMs,
    frames: intervals.length,
    p50Ms: quantile(intervals, 0.5),
    p95Ms: quantile(intervals, 0.95),
    p99Ms: quantile(intervals, 0.99),
    maxMs: Math.max(...intervals),
    longTasks: observer === undefined ? null : { count: longTasks.length, totalMs: sum(longTasks) },
  };

  return JSON.stringify(result);
}
