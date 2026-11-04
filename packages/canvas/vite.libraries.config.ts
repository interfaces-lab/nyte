import { LIBRARY_EXPORTS } from "@nyte-ai/plugin/canvas/protocol";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist/shell/libraries",
    emptyOutDir: true,
    target: ["chrome123", "safari16.4"],
    minify: true,
    modulePreload: false,
    chunkSizeWarningLimit: 1_000,
    rolldownOptions: {
      input: Object.fromEntries(Object.keys(LIBRARY_EXPORTS).map((name) => [name, name])),
      preserveEntrySignatures: "strict",
      output: {
        format: "es",
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
      },
    },
  },
});
