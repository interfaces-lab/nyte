import stylex from "@stylexjs/unplugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { resolve } from "node:path";
export default defineConfig({
  root: resolve(".composer-qa"),
  base: "./",
  plugins: [
    stylex.vite({ devMode: "off", runtimeInjection: false, useCSSLayers: true }),
    react({ babel: { plugins: ["babel-plugin-react-compiler"] } }),
  ],
  resolve: {
    alias: { "node:crypto": resolve("src/renderer/src/browser-crypto.ts") },
    dedupe: ["react", "react-dom"],
  },
  build: { outDir: "/tmp/nyte-composer-qa", emptyOutDir: true },
});
