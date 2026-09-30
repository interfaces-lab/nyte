import stylex from "@stylexjs/unplugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { resolve } from "node:path";
import { defaultClientConditions, type Plugin } from "vite";
import { dropInlinedGhosttyWasm } from "@nyte-ai/app/vite";

export default defineConfig(({ command }) => ({
  main: {
    build: {
      minify: true,
      target: "node24",
      rolldownOptions: {
        input: {
          index: resolve("src/main/index.ts"),
          // Worker threads started by the main entry: the usage scan and the SQLite store.
          "usage-worker": resolve("src/main/usage-worker.ts"),
          "store-worker": resolve("src/main/store-worker.ts"),
        },
        output: { entryFileNames: "[name].js", chunkFileNames: "chunks/[name]-[hash].js" },
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
