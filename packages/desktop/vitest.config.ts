import { stylex } from "@nyte-ai/app/vite";
import { defaultClientConditions } from "vite";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [stylex.rollup({ devMode: "css-only" })],
  resolve: { conditions: ["nyte-source", ...defaultClientConditions] },
  test: {
    setupFiles: ["src/shared/fixtures/isolated-home.ts"],
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
