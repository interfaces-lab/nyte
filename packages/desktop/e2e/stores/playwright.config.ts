import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: /\.spec\.ts$/u,
  outputDir: join(tmpdir(), "nyte-stores-results"),
  workers: 1,
  timeout: 240_000,
  reporter: [["list"]],
});
