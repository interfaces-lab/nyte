import { stylex } from "@nyte-ai/app/vite";
import { defaultClientConditions } from "vite";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // Compile renderer styles without starting StyleX's CSS hot-reload timer in Vitest.
  plugins: [stylex.rollup({ devMode: "css-only" })],
  resolve: { conditions: ["nyte-source", ...defaultClientConditions] },
  test: {
    exclude: [...configDefaults.exclude, "benchmark/**/*.spec.ts"],
    setupFiles: ["src/main/fixtures/isolated-home.ts"],
  },
});
