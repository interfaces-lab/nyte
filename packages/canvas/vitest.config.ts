import { stylex } from "@nyte-ai/ui/stylex";
import { defaultClientConditions, defaultServerConditions } from "vite";
import { defineConfig } from "vitest/config";

const conditions = ["nyte-source"];

export default defineConfig({
  plugins: [stylex.rollup({ devMode: "css-only" })],
  // The kit compiles `@nyte-ai/ui` from source, as the shell build does; the node pool resolves through the ssr conditions.
  resolve: { conditions: [...conditions, ...defaultClientConditions] },
  ssr: { resolve: { conditions: [...conditions, ...defaultServerConditions] } },
  test: { include: ["test/**/*.test.ts"], server: { deps: { inline: [/packages\/ui\//] } } },
});
