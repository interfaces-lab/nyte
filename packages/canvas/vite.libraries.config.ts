import { LIBRARY_EXPORTS } from "@nyte-ai/plugin/canvas/protocol";
import { defineConfig } from "vite";

/**
 * Builds each canvas library as its own ES module beside the shell, in
 * `dist/shell/libraries/<specifier>.js`, with the code two of them share in
 * `chunks/`. The shell imports one only when a canvas does.
 */
export default defineConfig({
  build: {
    outDir: "dist/shell/libraries",
    emptyOutDir: true,
    target: ["chrome123", "safari16.4"],
    minify: true,
    modulePreload: false,
    lib: {
      entry: Object.fromEntries(
        Object.keys(LIBRARY_EXPORTS).map((name) => [name, `src/libraries/${name}.ts`]),
      ),
      formats: ["es"],
      fileName: (_format, name) => `${name}.js`,
    },
    rolldownOptions: { output: { chunkFileNames: "chunks/[name]-[hash].js" } },
  },
});
