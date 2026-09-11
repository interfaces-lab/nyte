import stylex from "@stylexjs/unplugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import packageMetadata from "./package.json" with { type: "json" };

const esbuild = { tsconfigRaw: { compilerOptions: { target: "ES2024" } } };
const rendererInput = resolve("src/renderer/index.html");

// ghostty-web inlines its wasm as a 1.3 MiB base64 fallback. The terminal always
// passes the emitted asset URL, so the fallback is dead weight.
function dropInlinedGhosttyWasm(): Plugin {
  const inlinedWasm = /"data:application\/wasm;base64,[A-Za-z0-9+/=]+"/u;
  return {
    name: "nyte:drop-inlined-ghostty-wasm",
    apply: "build",
    transform(code, id) {
      if (!id.split("?")[0]?.endsWith("/ghostty-web/dist/ghostty-web.js")) return null;
      if (!inlinedWasm.test(code)) {
        this.error("ghostty-web no longer inlines its wasm; remove dropInlinedGhosttyWasm");
      }
      return { code: code.replace(inlinedWasm, '""'), map: null };
    },
  };
}

export default defineConfig(({ command }) => {
  const watch = command === "serve" ? {} : undefined;
  return {
    main: {
      esbuild,
      build: {
        watch,
        externalizeDeps: {
          exclude: Object.keys(packageMetadata.dependencies).filter((name) =>
            name.startsWith("@nyte-ai/"),
          ),
        },
        minify: true,
        reportCompressedSize: false,
        target: "node24",
        rollupOptions: {
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
      esbuild,
      build: {
        watch,
        externalizeDeps: { exclude: ["@nyte-ai/core", "@nyte-ai/protocol"] },
        minify: true,
        reportCompressedSize: false,
        target: "node24",
        rollupOptions: {
          input: resolve("src/preload/index.ts"),
          treeshake: { moduleSideEffects: false },
          output: { format: "cjs", entryFileNames: "[name].js" },
        },
      },
    },
    renderer: {
      esbuild,
      plugins: [
        dropInlinedGhosttyWasm(),
        stylex.vite({
          // Development installs component rules before React mounts them.
          // Production still extracts one layered stylesheet.
          devMode: command === "serve" ? "css-only" : "off",
          runtimeInjection: command === "serve",
          useCSSLayers: true,
          lightningcssOptions: { targets: { chrome: 142 << 16 } },
        }),
        react({ babel: { plugins: ["babel-plugin-react-compiler"] } }),
      ],
      optimizeDeps: { exclude: ["@nyte-ai/ui"], include: ["react", "react-dom/client"] },
      resolve: {
        alias: { "node:crypto": resolve("src/renderer/src/browser-crypto.ts") },
        dedupe: ["react", "react-dom"],
      },
      build: {
        chunkSizeWarningLimit: 6_000,
        minify: true,
        reportCompressedSize: false,
        target: "chrome142",
        rollupOptions: { input: rendererInput },
      },
      server: { host: "127.0.0.1", port: 5174, strictPort: true },
    },
  };
});
