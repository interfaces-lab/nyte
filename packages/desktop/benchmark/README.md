# Desktop benchmarks

These 10 serial Playwright scenarios run the built Electron app against isolated HOME, NYTE_HOME, workspace, SQLite, and model-catalog fixtures. They make no provider requests.

The scenarios port observable behavior from OpenCode v2 commit `8f4d7066473ea07d26c5dfc35e46cd9a94e3e292`: cold startup, first navigation, streaming stability, catalog retention, hidden terminal output, terminal teardown, terminal tab switching, five-session cycling, watch reconnection, and completed Markdown disposal. Each spec links to its exact upstream source.

## Run

From the repository root:

```sh
pnpm bench:desktop
```

For comparison runs, build once and repeat the scenarios serially:

```sh
pnpm --dir packages/desktop build
pnpm --dir packages/desktop exec playwright test \
  --config benchmark/playwright.config.ts \
  --repeat-each=20 --retries=0
```

Keep the Mac on power, close unrelated busy apps, and compare frozen builds on the same machine. Do not treat a single run as a baseline.

Results are written to `packages/desktop/benchmark/results/desktop-benchmark.jsonl`. Override the directory with `NYTE_DESKTOP_BENCHMARK_OUTPUT` and attach a run ID with `NYTE_DESKTOP_BENCHMARK_RUN_ID`.

## Measurements

Every measured action and post-settle window records:

- duration for the user-visible operation
- CPU across the full Nyte process tree on macOS
- Electron idle wakeups per second, which catch timer and wakeup spin
- RSS and process count for Electron and descendants, including terminal PTYs
- Electron process details
- macOS `top` POWER for the full process tree

`top` POWER is an Energy Impact proxy, not watts or joules. On other platforms POWER is `null`, CPU and wakeups come from Electron app metrics, and process-tree coverage depends on `ps`.

`NYTE_DESKTOP_BENCHMARK_INTERVAL_MS` controls the sample interval and defaults to 1000 ms. `NYTE_DESKTOP_BENCHMARK_SETTLE_MS` controls the idle window and defaults to 3000 ms. macOS POWER collection primes `top` with two one-second samples, so collection outlives short actions without changing their reported duration.

Renderer retention scenarios also force garbage collection and record CDP heap and DOM counters. Those values cover the renderer main isolate, not total desktop memory.
