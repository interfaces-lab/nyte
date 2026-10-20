import react from "@vitejs/plugin-react";
import { defineConfig, type UserConfig } from "electron-vite";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveQuickJSWasmPath } from "@nyte-ai/plugin/core/codemode-runtime";
import { defaultClientConditions, type Plugin } from "vite";
import { deferredEntries } from "@nyte-ai/app/deferred-entries.ts";
import { PICKER_SCRIPT } from "./src/main/browser-picker-page.ts";
import {
  deferredChunks,
  dropInlinedGhosttyWasm,
  shareCentralIconBase,
  stylex,
  withoutKatex,
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
        module: new URL("./src/account/clerk.tsx", import.meta.url).href,
        packages: ["@clerk/"],
      },
    }),
    withoutKatex(),
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

const config = (): UserConfig => ({
  main: {
    plugins: [
      {
        name: "nyte:codemode-wasm",
        async generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "quickjs.wasm",
            source: await readFile(resolveQuickJSWasmPath()),
          });
        },
      } satisfies Plugin,
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
    build: {
      minify: true,
      target: "node24",
      rolldownOptions: {
        input: {
          index: resolve("src/main/index.ts"),
          "host-entry": resolve("src/main/host-entry.ts"),
          "usage-worker": resolve("src/main/usage-worker.ts"),
          "codemode-worker": resolve("src/main/codemode-worker.ts"),
          "codemode-runtime": resolve("src/main/codemode-runtime.ts"),
        },
        output: {
          entryFileNames: "[name].js",
          chunkFileNames: (chunk) =>
            chunk.moduleIds.includes(resolve("src/main/codemode-runtime.ts"))
              ? "[name]-[hash].js"
              : "chunks/[name].js",
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

export default defineConfig(config);
