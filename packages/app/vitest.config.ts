import { globSync, readFileSync } from "node:fs";
import { stylex } from "@nyte-ai/ui/stylex";
import { defaultClientConditions } from "vite";
import { configDefaults, defineConfig } from "vitest/config";
const electronTests = globSync("{src,test}/**/*.test.{ts,tsx}")
  .filter((file) => /testRenderer|from "electron"/u.test(readFileSync(file, "utf8")))
  .map((file) => file.replaceAll("\\", "/"));

export default defineConfig({
  plugins: [stylex.rollup({ devMode: "css-only" })],
  resolve: { conditions: ["nyte-source", ...defaultClientConditions] },
  test: {
    projects: [
      {
        extends: true,
        test: { name: "unit", exclude: [...configDefaults.exclude, "e2e/**", ...electronTests] },
      },
      {
        extends: true,
        test: {
          name: "electron",
          include: electronTests,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
