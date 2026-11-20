import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
import process from "node:process";

const CI = process.env.CI !== undefined && process.env.CI !== "";

process.env.TMPDIR = "/tmp";

process.env.NYTE_E2E_STARTED ??= String(Date.now());

export default defineConfig({
  testDir: import.meta.dirname,
  outputDir: resolve(import.meta.dirname, "test-results"),
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  maxFailures: CI ? 8 : 0,
  workers: 1,
  timeout: 120_000,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: { trace: "on-first-retry" },
});
