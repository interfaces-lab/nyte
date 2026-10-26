import { stylex } from "@nyte-ai/ui/stylex";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defaultClientConditions, defaultServerConditions, defineConfig } from "vite";

/** A blank room: StyleX and nothing else. No Tailwind, no inherited palette. */
export default defineConfig({
  resolve: {
    conditions: ["nyte-source", ...defaultClientConditions],
    dedupe: ["react", "react-dom", "@stylexjs/stylex", "remotion"],
  },
  ssr: { resolve: { conditions: ["nyte-source", ...defaultServerConditions] } },
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
      /**
       * The desktop's Electron Chromium. Older targets make lightningcss
       * polyfill the tokens' light-dark() with variables nothing here defines.
       */
      lightningcssOptions: { targets: { chrome: 152 << 16 } },
    }),
    tanstackStart({ srcDirectory: "src" }),
    react(),
  ],
  server: { port: 5178 },
});
