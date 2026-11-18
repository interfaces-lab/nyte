import { join } from "node:path";
import { stylex } from "@nyte-ai/ui/stylex";
import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig } from "vite";

export default defineConfig(() => ({
  root: "src/board",
  base: "./",
  plugins: [
    stylex.vite({
      useCSSLayers: true,
      lightningcssOptions: { targets: { chrome: 123 << 16, safari: (16 << 16) | (4 << 8) } },
    }),
    react(),
  ],
  resolve: {
    conditions: ["nyte-source", ...defaultClientConditions],
    dedupe: ["react", "react-dom"],
  },
  build: {
    outDir: "../../dist/board",
    emptyOutDir: true,
    target: ["chrome123", "safari16.4"],
    modulePreload: false,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 2_000,
    assetsInlineLimit: 0,
    rolldownOptions: {
      input: join(import.meta.dirname, "src/board/board.html"),
      output: { codeSplitting: false },
    },
  },
}));
