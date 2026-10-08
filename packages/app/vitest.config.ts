import { stylex } from "@nyte-ai/ui/stylex";
import { defaultClientConditions } from "vite";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // Compile renderer styles without starting StyleX's CSS hot-reload timer in Vitest.
  plugins: [stylex.rollup({ devMode: "css-only" })],
  resolve: { conditions: ["nyte-source", ...defaultClientConditions] },
  // Playwright owns e2e/.
  test: { exclude: [...configDefaults.exclude, "e2e/**"] },
});
