import { globSync, readFileSync } from "node:fs";
import { stylex } from "@nyte-ai/ui/stylex";
import { defaultClientConditions } from "vite";
import { configDefaults, defineConfig } from "vitest/config";

// Each of these drives its own Electron; run side by side they starve each other of frames.
const electronTests = globSync("{src,test}/**/*.test.{ts,tsx}").filter((file) =>
  /testRenderer|from "electron"/u.test(readFileSync(file, "utf8")),
);

export default defineConfig({
  // Compile renderer styles without starting StyleX's CSS hot-reload timer in Vitest.
  plugins: [stylex.rollup({ devMode: "css-only" })],
  resolve: { conditions: ["nyte-source", ...defaultClientConditions] },
  test: {
    projects: [
      {
        extends: true,
        // Playwright owns e2e/.
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
