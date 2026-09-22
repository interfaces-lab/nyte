// Based on https://github.com/anomalyco/opencode/blob/8f4d7066473ea07d26c5dfc35e46cd9a94e3e292/packages/app/e2e/performance/timeline/provider-memory-benchmark.spec.ts
import type { CDPSession } from "@playwright/test";
import { benchmark, expect } from "./benchmark.ts";
import { launchDesktop, openBenchmarkSession } from "./desktop.ts";
import { DEFAULT_CATALOG_MODEL_COUNT } from "./fixtures.ts";
import { measureOperation, measureSettledDesktop } from "./measure.ts";

const SESSION_SWITCHES = [0, 1, 2, 0, 2, 1, 0, 1, 2, 1, 0, 2];

async function retainedMemory(client: CDPSession, sessionId: string) {
  await client.send("HeapProfiler.collectGarbage");

  const [heap, dom] = await Promise.all([
    client.send("Runtime.getHeapUsage"),
    client.send("Memory.getDOMCounters"),
  ]);

  return { sessionId, heap, dom };
}

benchmark("measures retained renderer memory with a large model catalog", async ({ report }) => {
  const desktop = await launchDesktop({
    sessionCount: 3,
    turnsPerSession: 1,
    catalogModelCount: DEFAULT_CATALOG_MODEL_COUNT,
  });

  const client = await desktop.page.context().newCDPSession(desktop.page);

  try {
    const modelName = "Desktop benchmark model 1200";

    const action = await measureOperation(desktop, async () => {
      const trigger = desktop.page.getByRole("button", { name: /^Model:/u }).first();
      await trigger.click();
      await desktop.page.getByRole("menuitem", { name: /^Model\b/u }).click();
      const search = desktop.page.getByRole("combobox", { name: "Search models" });
      await expect(search).toBeVisible();
      await search.fill(desktop.fixture.catalog.lastModelId);
      await desktop.page.getByText(modelName, { exact: true }).click();
      await expect(
        desktop.page.getByRole("button", { name: `Model: ${modelName}`, exact: true }),
      ).toBeVisible();

      const memory = [];

      for (const sessionIndex of SESSION_SWITCHES) {
        await openBenchmarkSession(desktop, sessionIndex);
        const session = desktop.fixture.sessions[sessionIndex];

        if (session === undefined) throw new Error("Missing catalog benchmark session");
        memory.push(await retainedMemory(client, session.id));
      }

      return memory;
    });

    const idle = await measureSettledDesktop(desktop);
    const finalSession = desktop.fixture.sessions[2];

    if (finalSession === undefined) throw new Error("Missing final catalog benchmark session");
    const finalMemory = await retainedMemory(client, finalSession.id);
    expect(desktop.pageErrors).toEqual([]);
    report(
      {
        action: {
          durationMs: action.durationMs,
          memory: action.result,
          processes: action.processes,
        },
        idle: { memory: finalMemory, processes: idle },
      },
      {
        catalogModelCount: desktop.fixture.catalog.modelCount,
        sessionSwitchCount: SESSION_SWITCHES.length,
      },
    );
  } finally {
    try {
      await client.detach().catch(() => undefined);
    } finally {
      await desktop.close();
    }
  }
});
