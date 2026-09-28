import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
import process from "node:process";
import { E2E_ORIGIN } from "./server/address.ts";

const CI = process.env.CI !== undefined && process.env.CI !== "";

const selectedProjects = process.argv.flatMap((arg, index, args) => {
  if (arg === "--project") return args.slice(index + 1, index + 2);

  return arg.startsWith("--project=") ? [arg.slice("--project=".length)] : [];
});

// Playwright starts `webServer` for every project; only `web` uses it.
const webSelected = selectedProjects.length === 0 || selectedProjects.includes("web");

export default defineConfig({
  outputDir: resolve(import.meta.dirname, "test-results"),
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: { trace: "on-first-retry", screenshot: "only-on-failure" },
  projects: [
    {
      name: "web",
      testDir: resolve(import.meta.dirname, "web"),
      use: { baseURL: E2E_ORIGIN },
    },
    {
      name: "desktop",
      testDir: resolve(import.meta.dirname, "desktop"),
      workers: 1,
      timeout: 120_000,
    },
  ],
  webServer: webSelected
    ? {
        command: "node e2e/server/start.ts",
        cwd: resolve(import.meta.dirname, ".."),
        url: `${E2E_ORIGIN}/`,
        reuseExistingServer: !CI,
        // The default is SIGKILL, which skips the server's cleanup.
        gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
        stdout: "pipe",
        stderr: "pipe",
      }
    : undefined,
});
