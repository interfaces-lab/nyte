// Based on https://github.com/anomalyco/opencode/blob/8f4d7066473ea07d26c5dfc35e46cd9a94e3e292/packages/app/e2e/regression/session-timeline-transport.spec.ts
import { benchmark, expect } from "./benchmark.ts";
import { launchDesktop, openBenchmarkSession } from "./desktop.ts";
import { measureOperation, measureSettledDesktop } from "./measure.ts";
import { openBenchmarkSessionWriter } from "./session-writer.ts";

const RUN_ID = "desktop-benchmark-transport-run";

const RECOVERED_MARKDOWN = "# Transport watch recovered";

benchmark("reconnects after a stream error", async ({ report }) => {
  const desktop = await launchDesktop({ sessionCount: 1, turnsPerSession: 1 });

  try {
    const writer = await openBenchmarkSessionWriter(desktop.fixture, 0);

    try {
      await openBenchmarkSession(desktop, 0);
      const user = "Exercise the desktop watch reconnect path.";
      await writer.appendUser(user);
      await expect(desktop.page.getByText(user, { exact: true })).toBeVisible();
      await writer.appendTextDelta(RUN_ID, 0, "# Transport watch baseline");

      const baseline = desktop.page.getByRole("heading", {
        name: "Transport watch baseline",
        exact: true,
      });

      await expect(baseline).toBeVisible();

      const reconnect = await measureOperation(desktop, async () => {
        await writer.interruptWatchProjection();
        await baseline.waitFor({ state: "detached" });
        await writer.appendTextDelta(RUN_ID, 0, RECOVERED_MARKDOWN);
        await expect(
          desktop.page.getByRole("heading", { name: "Transport watch recovered", exact: true }),
        ).toBeVisible();
      });

      await writer.settleAssistant(RUN_ID, RECOVERED_MARKDOWN);
      await expect(
        desktop.page.getByRole("heading", { name: "Transport watch recovered", exact: true }),
      ).toHaveCount(1);
      const idle = await measureSettledDesktop(desktop);
      expect(desktop.pageErrors).toEqual([]);
      report(
        {
          reconnect: { durationMs: reconnect.durationMs, processes: reconnect.processes },
          idle: { processes: idle },
        },
        { runId: RUN_ID, corruptRefPublished: false },
      );
    } finally {
      await writer.close();
    }
  } finally {
    await desktop.close();
  }
});
