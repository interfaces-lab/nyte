import { test as base } from "@playwright/test";

interface BenchmarkFixtures {
  readonly report: (
    metrics: Readonly<Record<string, unknown>>,
    context?: Readonly<Record<string, unknown>>,
  ) => void;
}

export const benchmark = base.extend<BenchmarkFixtures>({
  report: async ({ browserName: _browserName }, use, testInfo) => {
    let payload:
      | {
          readonly metrics: Readonly<Record<string, unknown>>;
          readonly context: Readonly<Record<string, unknown>>;
        }
      | undefined;

    await use((metrics, context = {}) => {
      if (payload !== undefined) throw new Error("Benchmark reported metrics more than once");
      payload = { metrics, context };
    });

    if (payload === undefined) {
      if (testInfo.status === testInfo.expectedStatus) {
        throw new Error(`Benchmark did not report metrics: ${testInfo.title}`);
      }

      return;
    }

    process.stdout.write(
      `BENCHMARK ${JSON.stringify({
        schemaVersion: 1,
        runId: process.env["NYTE_DESKTOP_BENCHMARK_RUN_ID"] ?? null,
        name: testInfo.titlePath.slice(1).join(" > "),
        status: testInfo.status,
        expectedStatus: testInfo.expectedStatus,
        retry: testInfo.retry,
        repeat: testInfo.repeatEachIndex,
        context: { project: testInfo.project.name, platform: process.platform, ...payload.context },
        metrics: payload.metrics,
      })}\n`,
    );
  },
});

export const expect = benchmark.expect;
