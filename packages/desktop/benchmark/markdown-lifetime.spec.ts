// Based on https://github.com/anomalyco/opencode/blob/8f4d7066473ea07d26c5dfc35e46cd9a94e3e292/packages/session-ui/performance/markdown-lifetime/lifetime.bench.ts
import type { CDPSession } from "@playwright/test";
import { benchmark, expect } from "./benchmark.ts";
import { launchDesktop, openBenchmarkSession } from "./desktop.ts";
import { measureOperation, measureSettledDesktop } from "./measure.ts";

const MARKDOWN_BLOCK_COUNT = 80;

const LINES_PER_BLOCK = 96;

const LARGE_MARKDOWN = [
  "# Completed Markdown lifetime source",
  ...Array.from({ length: MARKDOWN_BLOCK_COUNT }, (_, blockIndex) => {
    const block = String(blockIndex + 1).padStart(3, "0");

    const code = Array.from({ length: LINES_PER_BLOCK }, (_, lineIndex) => {
      const line = String(lineIndex).padStart(3, "0");

      return `export const lifetime_${block}_${line} = "deterministic payload ${block}:${line}";`;
    }).join("\n");

    return `## Lifetime block ${String(blockIndex + 1)}\n\n\`\`\`ts\n${code}\n\`\`\``;
  }),
].join("\n\n");

async function captureRendererAfterGarbageCollection(cdp: CDPSession) {
  await cdp.send("HeapProfiler.collectGarbage");
  const performanceResult = await cdp.send("Performance.getMetrics");
  const heap = await cdp.send("Runtime.getHeapUsage");
  const dom = await cdp.send("Memory.getDOMCounters");

  return {
    capturedAtMs: Date.now(),
    performance: Object.fromEntries(
      performanceResult.metrics.map((metric) => [metric.name, metric.value]),
    ),
    heap,
    dom,
  };
}

benchmark("completed Markdown: leave", async ({ report }) => {
  const desktop = await launchDesktop({
    sessionCount: 1,
    turnsPerSession: 1,
    assistantMarkdown: LARGE_MARKDOWN,
  });

  let cdp: CDPSession | undefined;

  try {
    cdp = await desktop.page.context().newCDPSession(desktop.page);
    await cdp.send("Performance.enable");

    await openBenchmarkSession(desktop, 0);
    const source = desktop.fixture.sessions[0];

    if (source === undefined) throw new Error("Markdown lifetime benchmark requires one session");
    const sourcePromptText = `Benchmark prompt 0001 for ${source.name}`;
    const sourcePrompt = desktop.page.getByText(sourcePromptText, { exact: true });
    await expect(sourcePrompt).toBeVisible();
    const obsoleteSource = await sourcePrompt.elementHandle();

    if (obsoleteSource === null) throw new Error("The source prompt did not have a DOM node");

    const before = await captureRendererAfterGarbageCollection(cdp);
    const sourceFallbackCodeBlocks = await desktop.page.locator("figure pre code").count();
    expect(sourceFallbackCodeBlocks).toBeGreaterThan(0);

    const action = await measureOperation(desktop, async () => {
      await desktop.page
        .getByRole("navigation", { name: "Sessions and workspaces" })
        .getByRole("button", { name: /^New Chat/u })
        .click();
      await expect(desktop.page.getByRole("form", { name: "Message composer" })).toBeVisible();
      await expect(desktop.page.getByText(sourcePromptText, { exact: true })).toHaveCount(0);

      const obsoleteSourceConnected = await obsoleteSource.evaluate(
        (element) => element.isConnected,
      );

      expect(obsoleteSourceConnected).toBe(false);

      return { obsoleteSourceConnected, sourceFallbackCodeBlocks };
    });

    const postSettle = await measureSettledDesktop(desktop);
    const after = await captureRendererAfterGarbageCollection(cdp);
    await expect(desktop.page.getByRole("form", { name: "Message composer" })).toBeVisible();
    await expect(desktop.page.getByText(sourcePromptText, { exact: true })).toHaveCount(0);
    expect(desktop.pageErrors).toEqual([]);

    report(
      {
        action: {
          durationMs: action.durationMs,
          processEnergy: action.processes,
          lifetime: action.result,
        },
        renderer: { before, after },
        postSettle: { processEnergy: postSettle },
      },
      {
        markdownCharacters: LARGE_MARKDOWN.length,
        fencedBlocks: MARKDOWN_BLOCK_COUNT,
        linesPerBlock: LINES_PER_BLOCK,
        sourceSessionId: source.id,
        destination: "new-chat",
        fixture: desktop.fixture.metadata,
      },
    );
  } finally {
    try {
      await cdp?.detach().catch(() => undefined);
    } finally {
      await desktop.close();
    }
  }
});
