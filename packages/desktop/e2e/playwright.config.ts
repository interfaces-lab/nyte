import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
import process from "node:process";

const CI = process.env.CI !== undefined && process.env.CI !== "";

export default defineConfig({
  testDir: import.meta.dirname,
  testIgnore: "stores/**",
  outputDir: resolve(import.meta.dirname, "test-results"),
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  workers: 1,
  timeout: 120_000,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: { trace: "on-first-retry", screenshot: "only-on-failure" },
});
