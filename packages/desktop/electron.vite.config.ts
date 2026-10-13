import react from "@vitejs/plugin-react";
import { defineConfig, type UserConfig } from "electron-vite";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveQuickJSWasmPath } from "@nyte-ai/plugin/codemode-runtime";
import { defaultClientConditions, type Plugin } from "vite";
import { dropInlinedGhosttyWasm, stylex } from "@nyte-ai/app/vite";
import { deferredClerk } from "./account.vite.ts";

/** Mode `e2e` builds main alone into `out-e2e/main`, over the offline catalog instead of `src/main/models.ts`. */
const offlineModels: Plugin = {
  name: "nyte:e2e-models",
  enforce: "pre",
  resolveId(source, importer) {
    if (importer === undefined || resolve(importer, "..", source) !== resolve("src/main/models.ts"))
      return null;

    return resolve("src/main/fixtures/e2e-models.ts");
  },
};

const config = (mode: string): UserConfig => ({
  main: {
    plugins: [
      ...(mode === "e2e" ? [offlineModels] : []),
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
    ],
    build: {
      ...(mode === "e2e" ? { outDir: "out-e2e/main" } : {}),
      minify: true,
      target: "node24",
      rolldownOptions: {
        input: {
          index: resolve("src/main/index.ts"),
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
        },
        treeshake: { moduleSideEffects: false },
        output: { format: "cjs", entryFileNames: "[name].js" },
      },
    },
  },
  renderer: {
    plugins: [
      deferredClerk(),
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
    /* StyleX compiles @nyte-ai/ui from source here, so resolve its `nyte-source` condition. */
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
  },
});

export default defineConfig(({ mode }) => {
  const { main, ...rest } = config(mode);

  return mode === "e2e" ? { main } : { main, ...rest };
});
