// Based on https://github.com/anomalyco/opencode/blob/8f4d7066473ea07d26c5dfc35e46cd9a94e3e292/packages/app/e2e/regression/session-workspace-tab-cycle.spec.ts
import { benchmark, expect } from "./benchmark.ts";
import { launchDesktop, openBenchmarkSession } from "./desktop.ts";
import { measureOperation, measureSettledDesktop } from "./measure.ts";
import { openBenchmarkSessionWriter } from "./session-writer.ts";

const SESSIONS = [0, 1, 2, 3, 4];
const SWITCHES = [...SESSIONS, ...SESSIONS.toReversed(), ...SESSIONS, ...SESSIONS.toReversed()];

benchmark(
  "keeps five loaded workspace tabs visible and reactive through repeated switches",
  async ({ report }) => {
    const desktop = await launchDesktop({ sessionCount: SESSIONS.length, turnsPerSession: 1 });
    try {
      const writer = await openBenchmarkSessionWriter(desktop.fixture, 0);
      try {
        for (const index of SESSIONS) await openBenchmarkSession(desktop, index);
        const action = await measureOperation(desktop, async () => {
          const durations = [];
          for (const index of SWITCHES) {
            const started = performance.now();
            await openBenchmarkSession(desktop, index);
            durations.push(performance.now() - started);
          }
          const update = "Still receiving benchmark updates";
          await writer.appendUser(update);
          await expect(desktop.page.getByText(update, { exact: true })).toBeVisible();
          return durations;
        });
        const idle = await measureSettledDesktop(desktop);
        expect(desktop.pageErrors).toEqual([]);
        report(
          {
            action: {
              durationMs: action.durationMs,
              switchDurationsMs: action.result,
              processes: action.processes,
            },
            idle: { processes: idle },
          },
          { loadedSessions: SESSIONS.length, repeatedSwitchCount: SWITCHES.length },
        );
      } finally {
        await writer.close();
      }
    } finally {
      await desktop.close();
    }
  },
);
