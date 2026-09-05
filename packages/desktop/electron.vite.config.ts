import stylex from "@stylexjs/unplugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { resolve } from "node:path";
import packageMetadata from "./package.json" with { type: "json" };

const esbuild = { tsconfigRaw: { compilerOptions: { target: "ES2024" } } };
const rendererInput = resolve("src/renderer/index.html");

export default defineConfig(({ command }) => ({
  main: {
    esbuild,
    build: {
      externalizeDeps: {
        exclude: Object.keys(packageMetadata.dependencies).filter((name) =>
          name.startsWith("@nyte-ai/"),
        ),
      },
      minify: true,
      reportCompressedSize: false,
      target: "node24",
      rollupOptions: {
        input: resolve("src/main/index.ts"),
        output: { chunkFileNames: "chunks/[name]-[hash].js" },
      },
    },
  },
  preload: {
    esbuild,
    build: {
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
      minify: true,
      reportCompressedSize: false,
      target: "chrome142",
      rollupOptions: { input: rendererInput },
    },
    server: { host: "127.0.0.1", port: 5174, strictPort: true },
  },
}));
