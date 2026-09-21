# Desktop benchmarks

These serial Playwright scenarios run the built Electron app against isolated HOME, NYTE_HOME, workspace, SQLite, model-catalog, shell, and server-setting fixtures. They make no provider requests. The delayed-server fixture binds loopback and never answers requests.

The startup cases cover empty Home, 50 saved workspaces, a restored 160-turn transcript, a remembered project with a two-second login shell, and a configured loopback server that does not respond. Other scenarios cover navigation, streaming, catalog retention, terminal lifetime, session cycling, watch reconnection, and completed Markdown disposal.

The restored-chat case first opens Settings in an unmeasured process to persist the startup preference. Its measured launch uses a fresh process with that existing profile, not an empty profile.

## Run

From the repository root:

```sh
pnpm bench:desktop
```

For comparison runs, freeze each `packages/desktop/out` directory and point the benchmark at it. The build root must contain `main/index.js` and its sibling renderer output.

```sh
NYTE_DESKTOP_BENCHMARK_BUILD_ROOT=/absolute/path/to/baseline/out \
NYTE_DESKTOP_BENCHMARK_OUTPUT=packages/desktop/benchmark/results/baseline \
NYTE_DESKTOP_BENCHMARK_RUN_ID=baseline \
pnpm --dir packages/desktop exec playwright test \
  --config benchmark/playwright.config.ts \
  benchmark/startup.spec.ts \
  --repeat-each=20 --workers=1 --retries=0

NYTE_DESKTOP_BENCHMARK_BUILD_ROOT=/absolute/path/to/candidate/out \
NYTE_DESKTOP_BENCHMARK_OUTPUT=packages/desktop/benchmark/results/candidate \
NYTE_DESKTOP_BENCHMARK_RUN_ID=candidate \
pnpm --dir packages/desktop exec playwright test \
  --config benchmark/playwright.config.ts \
  benchmark/startup.spec.ts \
  --repeat-each=20 --workers=1 --retries=0
```

Keep the Mac on power, close unrelated busy apps, and run baseline and candidate on the same machine. Do not treat one run as a baseline.

Results are written to `<output>/desktop-benchmark.jsonl`. Without an output override, the path is `packages/desktop/benchmark/results/desktop-benchmark.jsonl`.

## Measurements

Startup records wall time before Electron launches through connection, first window, visible shell readiness, and each scenario's useful screen. The 50-workspace case also joins a complete directory read before recording `settledScreenMs` and sampling idle resources. This keeps deferred directory work out of the idle comparison without hiding it from the startup timings. Other startup cases sample immediately after their useful screen is ready.

Renderer metrics include navigation milestones, first paint, first contentful paint, and Nyte performance marks and measures. Collection uses browser timing APIs after readiness and does not enable tracing or CPU profiling. Startup CPU before readiness is not sampled.

Every measured action and post-settle window records:

- duration for the user-visible operation
- CPU across the full Nyte process tree on macOS
- Electron idle wakeups per second
- RSS and process count for Electron and descendants, including terminal PTYs
- Electron process details
- macOS `top` POWER for the full process tree

`top` POWER is an Energy Impact proxy, not watts or joules. On other platforms POWER is `null`, CPU and wakeups come from Electron app metrics, and process-tree coverage depends on `ps`.

`NYTE_DESKTOP_BENCHMARK_INTERVAL_MS` controls the sample interval and defaults to 1000 ms. `NYTE_DESKTOP_BENCHMARK_SETTLE_MS` controls the idle window and defaults to 3000 ms. macOS POWER collection primes `top` with two one-second samples, so collection outlives short actions without changing their reported duration.

Renderer retention scenarios also force garbage collection and record CDP heap and DOM counters. Those values cover the renderer main isolate, not total desktop memory.
