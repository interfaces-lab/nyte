import stylex from "@stylexjs/unplugin";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // Compile renderer styles without starting StyleX's CSS hot-reload timer in Vitest.
  plugins: [stylex.rollup({ devMode: "css-only", runtimeInjection: false })],
  test: { exclude: [...configDefaults.exclude, "benchmark/**/*.spec.ts"] },
});
