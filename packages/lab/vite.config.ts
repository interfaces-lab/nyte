import { stylex } from "@nyte-ai/ui/stylex";
import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig, type Plugin } from "vite";
import { reviewCore } from "./server/plugin.ts";

/** A blank room: StyleX and nothing else. No Tailwind, no inherited palette. */
export default defineConfig(() => ({
  resolve: {
    conditions: ["nyte-source", ...defaultClientConditions],
    dedupe: ["react", "react-dom", "@stylexjs/stylex"],
  },
  optimizeDeps: {
    exclude: ["@nyte-ai/ui", "@nyte-ai/app"],
    include: [
      "react",
      "react-dom/client",
      "dialkit",
      "motion/react",
      "@pierre/diffs",
      "@pierre/diffs/react",
      "react-grab",
    ],
  },
  plugins: [
    stylex.vite({
      useCSSLayers: true,
      // The desktop's Electron Chromium. Older targets make lightningcss
      // polyfill the tokens' light-dark() with variables nothing here defines.
      lightningcssOptions: { targets: { chrome: 152 << 16 } },
    }),
    react(),
    reviewCore(),
    {
      name: "lab:serve-devtools",
      apply: "serve",
      transformIndexHtml: () => [
        {
          tag: "script",
          attrs: { type: "module", src: "/src/devtools.ts" },
          injectTo: "head-prepend",
        },
      ],
    } satisfies Plugin,
  ],
  build: {
    rolldownOptions: {
      input: {
        index: "index.html",
      },
    },
  },
  server: { port: 5178 },
}));
