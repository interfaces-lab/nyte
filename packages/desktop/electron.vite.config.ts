import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveQuickJSWasmPath } from "@nyte-ai/plugin/codemode-runtime";
import { defaultClientConditions, type Plugin } from "vite";
import { dropInlinedGhosttyWasm, stylex } from "@nyte-ai/app/vite";

export default defineConfig(({ command }) => ({
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
    ],
    build: {
      minify: true,
      target: "node24",
      rolldownOptions: {
        input: {
          index: resolve("src/main/index.ts"),
          "usage-worker": resolve("src/main/usage-worker.ts"),
          "store-worker": resolve("src/main/store-worker.ts"),
          "codemode-worker": resolve("src/main/codemode-worker.ts"),
          "codemode-runtime": resolve("src/main/codemode-runtime.ts"),
        },
        output: {
          entryFileNames: "[name].js",
          chunkFileNames: (chunk) =>
            chunk.moduleIds.includes(resolve("src/main/codemode-runtime.ts"))
              ? "[name]-[hash].js"
              : "chunks/[name]-[hash].js",
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
        input: resolve("src/preload/index.ts"),
        treeshake: { moduleSideEffects: false },
        output: { format: "cjs", entryFileNames: "[name].js" },
      },
    },
  },
  renderer: {
    plugins: [
      dropInlinedGhosttyWasm(),
      stylex.vite({
        // Development installs component rules before React mounts them.
        // Production still extracts one layered stylesheet.
        devMode: command === "serve" ? "css-only" : "off",
        runtimeInjection: command === "serve",
        useCSSLayers: true,
        // A key StyleX cannot compile, like `border`, fails the build instead of vanishing.
        propertyValidationMode: "throw",
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
      minify: true,
      target: "chrome152",
    },
    server: { host: "127.0.0.1", port: 5174, strictPort: true, forwardConsole: true },
  },
}));
