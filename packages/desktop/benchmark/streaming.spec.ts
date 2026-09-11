// Based on https://github.com/anomalyco/opencode/blob/8f4d7066473ea07d26c5dfc35e46cd9a94e3e292/packages/app/e2e/performance/timeline/session-timeline-benchmark.spec.ts
import { benchmark, expect } from "./benchmark.ts";
import { launchDesktop, openBenchmarkSession } from "./desktop.ts";
import { measureOperation, measureSettledDesktop } from "./measure.ts";
import { openBenchmarkSessionWriter } from "./session-writer.ts";

const RUN_ID = "desktop-benchmark-stream-run";
const DELTAS = Array.from({ length: 160 }, (_, index) =>
  index === 0 ? "# Streaming benchmark" : ` fragment-${String(index).padStart(3, "0")}`,
);
const MARKDOWN = DELTAS.join("");
const HEADING = MARKDOWN.slice(2);

benchmark("streams assistant text without remounting or oscillating", async ({ report }) => {
  const desktop = await launchDesktop({ sessionCount: 1, turnsPerSession: 1 });
  const writer = await openBenchmarkSessionWriter(desktop.fixture, 0);
  try {
    await openBenchmarkSession(desktop, 0);
    const action = await measureOperation(desktop, async () => {
      const user = "Stream the deterministic desktop benchmark response.";
      await writer.appendUser(user);
      await expect(desktop.page.getByText(user, { exact: true })).toBeVisible();

      const observation = desktop.page.evaluate(
        (prefix) =>
          new Promise<{
            frames: number;
            blankFrames: number;
            duplicateFrames: number;
            textRegressions: number;
            streamingHeadingMounts: number;
          }>((resolve) => {
            const streamingHeadings = new Set<Element>();
            let seen = false;
            let longest = 0;
            let frames = 0;
            let blankFrames = 0;
            let duplicateFrames = 0;
            let textRegressions = 0;
            const sample = (): void => {
              const headings = [...document.querySelectorAll("h1")].filter((heading) =>
                (heading.textContent ?? "").startsWith(prefix),
              );
              if (document.documentElement.dataset["nyteBenchmarkStreamPhase"] !== "settled") {
                for (const heading of headings) streamingHeadings.add(heading);
              }
              frames += 1;
              if (seen && headings.length === 0) blankFrames += 1;
              if (headings.length > 1) duplicateFrames += 1;
              if (headings.length > 0) {
                seen = true;
                const length = Math.max(
                  ...headings.map((heading) => heading.textContent?.length ?? 0),
                );
                if (length < longest) textRegressions += 1;
                longest = Math.max(longest, length);
              }
              if (document.documentElement.dataset["nyteBenchmarkStreamDone"] === "true") {
                resolve({
                  frames,
                  blankFrames,
                  duplicateFrames,
                  textRegressions,
                  streamingHeadingMounts: streamingHeadings.size,
                });
              } else {
                requestAnimationFrame(sample);
              }
            };
            requestAnimationFrame(sample);
          }),
        "Streaming benchmark",
      );

      for (const [index, delta] of DELTAS.entries()) {
        await writer.appendTextDelta(RUN_ID, 0, delta);
        if (index === 0) {
          await expect(
            desktop.page.getByRole("heading", { name: "Streaming benchmark", exact: true }),
          ).toBeVisible();
        }
      }
      await expect(desktop.page.getByRole("heading", { name: HEADING, exact: true })).toBeVisible();
      await desktop.page.evaluate(() => {
        document.documentElement.dataset["nyteBenchmarkStreamPhase"] = "settled";
      });
      await writer.settleAssistant(RUN_ID, MARKDOWN);
      await expect(desktop.page.getByRole("heading", { name: HEADING, exact: true })).toHaveCount(
        1,
      );
      await desktop.page.evaluate(() => {
        document.documentElement.dataset["nyteBenchmarkStreamDone"] = "true";
      });
      const rendering = await observation;
      expect(rendering.blankFrames).toBe(0);
      expect(rendering.duplicateFrames).toBe(0);
      expect(rendering.textRegressions).toBe(0);
      expect(rendering.streamingHeadingMounts).toBe(1);
      return rendering;
    });
    const idle = await measureSettledDesktop(desktop);
    expect(desktop.pageErrors).toEqual([]);
    report(
      {
        action: {
          durationMs: action.durationMs,
          rendering: action.result,
          processes: action.processes,
        },
        idle: { processes: idle },
      },
      { runId: RUN_ID, deltaCount: DELTAS.length, finalCharacters: MARKDOWN.length },
    );
  } finally {
    try {
      await writer.close();
    } finally {
      await desktop.close();
    }
  }
});
