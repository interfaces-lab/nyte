// Based on https://github.com/anomalyco/opencode/blob/8f4d7066473ea07d26c5dfc35e46cd9a94e3e292/packages/app/e2e/performance/devex/desktop-startup-benchmark.spec.ts
import { benchmark, expect } from "./benchmark.ts";
import { launchDesktop } from "./desktop.ts";
import { measureOperation, measureSettledDesktop } from "./measure.ts";

benchmark("opens a cold desktop on Home", async ({ report }) => {
  const desktop = await launchDesktop({ sessionCount: 0, turnsPerSession: 1 });
  try {
    const ready = await measureOperation(desktop, async () => {
      const pane = desktop.page.getByRole("region", { name: "Active chat pane" });
      await expect(pane.getByRole("form", { name: "Message composer" })).toBeVisible();
      await expect(desktop.page.getByText("No sessions yet", { exact: true })).toHaveCount(2);
      await expect(
        desktop.page
          .getByRole("navigation", { name: "Sessions and workspaces" })
          .getByRole("button", { name: /^New Chat/u }),
      ).toBeVisible();
    });
    const idle = await measureSettledDesktop(desktop);
    expect(desktop.pageErrors).toEqual([]);
    report(
      {
        startup: desktop.startup,
        ready: { durationMs: ready.durationMs, processes: ready.processes },
        idle: { processes: idle },
      },
      { fixture: desktop.fixture.metadata },
    );
  } finally {
    await desktop.close();
  }
});
