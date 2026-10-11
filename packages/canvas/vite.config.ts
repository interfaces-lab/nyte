import { stylex } from "@nyte-ai/ui/stylex";
import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig } from "vite";

/** The runtime shell: `src/shell/index.html` and everything it loads, built relative so any origin can serve it. */
export default defineConfig(() => ({
  root: "src/shell",
  base: "./",
  plugins: [
    stylex.vite({
      useCSSLayers: true,
      // Older targets make lightningcss polyfill the tokens' light-dark() and relative colours.
      lightningcssOptions: { targets: { chrome: 123 << 16, safari: (16 << 16) | (4 << 8) } },
    }),
    react(),
  ],
  optimizeDeps: { exclude: ["@nyte-ai/ui"], include: ["react", "react-dom/client"] },
  resolve: {
    conditions: ["nyte-source", ...defaultClientConditions],
    dedupe: ["react", "react-dom"],
  },
  build: {
    outDir: "../../dist/shell",
    emptyOutDir: true,
    target: ["chrome123", "safari16.4"],
    modulePreload: false,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 2_000,
    assetsInlineLimit: 0,
    rolldownOptions: { output: { codeSplitting: false } },
  },
}));
