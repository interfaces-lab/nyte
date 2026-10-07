import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

/** Outside the repository's `test-results/`, which another run's start would empty. */
const output = process.env.NYTE_REGISTRY_E2E_OUTPUT ?? join(tmpdir(), "nyte-e2e-registry");

/**
 * The browser against real headless registry hosts, with no account: the
 * built app on its own origin, one isolated host process per test.
 */
export default defineConfig({
  testDir: resolve(import.meta.dirname, "registry"),
  outputDir: join(output, "results"),
  forbidOnly: true,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"], ["html", { outputFolder: join(output, "report"), open: "never" }]],
  use: {
    // Set in the runner once the app server prints it; workers load this config after that.
    baseURL: process.env.NYTE_REGISTRY_APP_ORIGIN,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "node e2e/registry/app-server.ts",
    cwd: resolve(import.meta.dirname, ".."),
    // A port of its own each run, read from the server's output; nothing is probed or reused.
    wait: { stdout: /Serving the app at (?<nyte_registry_app_origin>http:\/\/127\.0\.0\.1:\d+)/u },
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    stdout: "pipe",
    stderr: "pipe",
    timeout: 30_000,
  },
});
