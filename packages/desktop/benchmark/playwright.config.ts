import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

export default defineConfig({
  testDir: resolve(import.meta.dirname),
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 5 * 60_000,
  expect: { timeout: 30_000 },
  outputDir:
    process.env["NYTE_DESKTOP_BENCHMARK_OUTPUT"] ?? resolve(import.meta.dirname, "results"),
  reporter: [["line"], [resolve(import.meta.dirname, "reporter.ts")]],
});
