import stylex from "@stylexjs/unplugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** A blank room: StyleX and nothing else. No Tailwind, no inherited palette. */
export default defineConfig(({ command }) => ({
  resolve: { dedupe: ["react", "react-dom", "@stylexjs/stylex"] },
  optimizeDeps: { include: ["react", "react-dom/client", "dialkit", "motion/react"] },
  plugins: [
    stylex.vite({
      devMode: command === "serve" ? "css-only" : "off",
      runtimeInjection: command === "serve",
      useCSSLayers: true,
    }),
    react(),
  ],
  build: {
    rollupOptions: { input: { index: "index.html", demo: "demo.html", core: "core.html" } },
  },
  server: { port: 5178 },
}));
