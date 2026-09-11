// Based on https://github.com/anomalyco/opencode/blob/8f4d7066473ea07d26c5dfc35e46cd9a94e3e292/packages/app/e2e/performance/timeline/first-navigation-benchmark.spec.ts
import { benchmark, expect } from "./benchmark.ts";
import { launchDesktop, openBenchmarkSession } from "./desktop.ts";
import { measureOperation, measureSettledDesktop } from "./measure.ts";

benchmark("opens an unvisited session tab without a blank frame", async ({ report }) => {
  const desktop = await launchDesktop({ sessionCount: 2, turnsPerSession: 1 });
  try {
    await openBenchmarkSession(desktop, 0);
    const source = desktop.fixture.sessions[0];
    const destination = desktop.fixture.sessions[1];
    if (source === undefined || destination === undefined) {
      throw new Error("Navigation benchmark requires two sessions");
    }
    const sourceText = `Benchmark prompt 0001 for ${source.name}`;
    const destinationText = `Benchmark prompt 0001 for ${destination.name}`;
    const pane = desktop.page.getByRole("region", { name: "Active chat pane" });
    await expect(pane.getByText(sourceText, { exact: true })).toBeVisible();

    const action = await measureOperation(desktop, async () => {
      const observation = desktop.page.evaluate(
        ({ sourceText, destinationText }) =>
          new Promise<string[]>((resolve) => {
            const frames: string[] = [];
            const sample = (): void => {
              const element = document.querySelector('[aria-label="Active chat pane"]');
              const text = element instanceof HTMLElement ? element.innerText.trim() : "";
              const frame = text.includes(destinationText)
                ? "destination"
                : text.includes(sourceText)
                  ? "source"
                  : text === ""
                    ? "blank"
                    : "unknown";
              frames.push(frame);
              if (frame === "destination") resolve(frames);
              else requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
          }),
        { sourceText, destinationText },
      );
      await openBenchmarkSession(desktop, 1);
      const frames = await observation;
      expect(frames.at(-1)).toBe("destination");
      expect(frames.filter((frame) => frame === "blank" || frame === "unknown")).toEqual([]);
      return frames;
    });
    const idle = await measureSettledDesktop(desktop);
    expect(desktop.pageErrors).toEqual([]);
    report(
      {
        action: {
          durationMs: action.durationMs,
          frames: action.result,
          processes: action.processes,
        },
        idle: { processes: idle },
      },
      { sourceSessionId: source.id, destinationSessionId: destination.id },
    );
  } finally {
    await desktop.close();
  }
});
