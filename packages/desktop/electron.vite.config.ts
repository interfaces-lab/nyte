import react from "@vitejs/plugin-react";
import { defineConfig, type UserConfig } from "electron-vite";
import { resolve } from "node:path";
import { defaultClientConditions, type Plugin } from "vite";
import { deferredEntries } from "@nyte-ai/app/lib/deferred-entries.ts";
import { PICKER_SCRIPT } from "./src/main/browser/browser-picker-page.ts";
import packageMetadata from "./package.json" with { type: "json" };
import {
  deferredChunks,
  dropInlinedGhosttyWasm,
  shareCentralIconBase,
  stylex,
} from "@nyte-ai/app/vite";

/**
 * The renderer. StyleX compiles @nyte-ai/ui from source here, so it resolves the
 * `nyte-source` condition.
 */
const renderer = {
  plugins: [
    deferredChunks({
      ...deferredEntries,
      account: {
        module: new URL("./src/renderer/src/account/clerk.tsx", import.meta.url).href,
        packages: ["@clerk/"],
      },
    }),
    shareCentralIconBase(),
    dropInlinedGhosttyWasm(),
    stylex.vite({
      useCSSLayers: true,
      lightningcssOptions: { targets: { chrome: 152 << 16 } },
    }),
    react({ compiler: true }),
    {
      name: "nyte:serve-devtools",
      apply: "serve",
      transformIndexHtml: () => [
        {
          tag: "script",
          attrs: { type: "module", src: "/src/devtools.tsx" },
          injectTo: "body",
        },
      ],
    } satisfies Plugin,
  ],
  optimizeDeps: {
    exclude: ["@nyte-ai/ui", "@nyte-ai/app"],
    include: ["react", "react-dom/client"],
  },
  resolve: {
    conditions: ["nyte-source", ...defaultClientConditions],
    dedupe: ["react", "react-dom"],
  },
  build: {
    chunkSizeWarningLimit: 6_000,
    manifest: true,
    minify: true,
    target: "chrome152",
    rolldownOptions: {
      input: { index: resolve("src/renderer/index.html") },
    },
  },
  server: { host: "127.0.0.1", port: 5174, strictPort: true, forwardConsole: true },
} satisfies UserConfig["renderer"];

const config = (mode: string): UserConfig => ({
  main: {
    define: {
      NYTE_BUILT_VERSION: JSON.stringify(
        process.env["NYTE_RELEASE_VERSION"] ?? packageMetadata.version,
      ),
    },
    plugins: [
      {
        name: "nyte:browser-picker-page",
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "browser-picker-page.js",
            source: PICKER_SCRIPT,
          });
        },
      } satisfies Plugin,
    ],
    resolve: { alias: { fflate: "fflate/browser" } },
    build: {
      ...(mode === "e2e" ? { outDir: "out-e2e/main" } : {}),
      externalizeDeps: { exclude: ["@clerk/electron"] },
      minify: true,
      target: "node24",
      rolldownOptions: {
        input: {
          index: resolve("src/main/index.ts"),
          "usage-worker": resolve("src/workers/usage-worker.ts"),
        },
        output: {
          entryFileNames: "[name].js",
          chunkFileNames: "chunks/[name].js",
        },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      minify: true,
      target: "node24",
      rolldownOptions: {
        input: {
          index: resolve("src/preload/index.ts"),
          "browser-page": resolve("src/preload/browser-page.ts"),
          "canvas-preview": resolve("src/preload/canvas-preview.ts"),
        },
        treeshake: { moduleSideEffects: false },
        output: { format: "cjs", entryFileNames: "[name].js" },
      },
    },
  },
  renderer,
});

export default defineConfig(({ mode }) => {
  const { main, ...rest } = config(mode);

  return mode === "e2e" ? { main } : { main, ...rest };
});
