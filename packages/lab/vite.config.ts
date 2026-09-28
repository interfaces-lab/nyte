import stylex from "@stylexjs/unplugin";
import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig } from "vite";

/** A blank room: StyleX and nothing else. No Tailwind, no inherited palette. */
export default defineConfig(({ command }) => ({
  resolve: {
    conditions: ["nyte-source", ...defaultClientConditions],
    dedupe: ["react", "react-dom", "@stylexjs/stylex"],
  },
  optimizeDeps: { include: ["react", "react-dom/client", "dialkit", "motion/react"] },
  plugins: [
    stylex.vite({
      devMode: command === "serve" ? "css-only" : "off",
      runtimeInjection: command === "serve",
      useCSSLayers: true,
      // The desktop's Electron Chromium. Older targets make lightningcss
      // polyfill the tokens' light-dark() with variables nothing here defines.
      lightningcssOptions: { targets: { chrome: 152 << 16 } },
    }),
    react(),
  ],
  build: {
    rollupOptions: {
      input: {
        index: "index.html",
        demo: "demo.html",
        core: "core.html",
        moon: "moon.html",
        environments: "environments.html",
      },
    },
  },
  server: { port: 5178 },
}));
