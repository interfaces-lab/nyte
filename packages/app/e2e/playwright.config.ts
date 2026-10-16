import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
import process from "node:process";
import { E2E_ORIGIN } from "./server/address.ts";

const CI = process.env.CI !== undefined && process.env.CI !== "";

export default defineConfig({
  testDir: resolve(import.meta.dirname, "web"),
  outputDir: resolve(import.meta.dirname, "test-results"),
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: { baseURL: E2E_ORIGIN, trace: "on-first-retry", screenshot: "only-on-failure" },
  webServer: {
    command: "node e2e/server/start.ts",
    cwd: resolve(import.meta.dirname, ".."),
    url: `${E2E_ORIGIN}/`,
    reuseExistingServer: !CI,
    // The default is SIGKILL, which skips the server's cleanup.
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    stdout: "pipe",
    stderr: "pipe",
  },
});
