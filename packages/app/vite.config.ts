import stylex from "@stylexjs/unplugin";
import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig } from "vite";

/** The browser build of the interface: `index.html` mounts `src/web/entry.tsx`. */
export default defineConfig(({ command }) => ({
  appType: "spa",
  plugins: [
    stylex.vite({
      // Development installs component rules before React mounts them.
      // Production still extracts one layered stylesheet.
      devMode: command === "serve" ? "css-only" : "off",
      runtimeInjection: command === "serve",
      useCSSLayers: true,
      // Older targets make lightningcss polyfill the tokens' light-dark() and
      // relative colours with variables nothing defines.
      lightningcssOptions: { targets: { chrome: 123 << 16 } },
    }),
    react({ babel: { plugins: ["babel-plugin-react-compiler"] } }),
  ],
  optimizeDeps: { exclude: ["@nyte-ai/ui"], include: ["react", "react-dom/client"] },
  /* StyleX compiles @nyte-ai/ui from source here, so resolve its `nyte-source` condition. */
  resolve: {
    conditions: ["nyte-source", ...defaultClientConditions],
    dedupe: ["react", "react-dom"],
  },
  build: { chunkSizeWarningLimit: 6_000 },
  server: { port: 5179, strictPort: true },
}));
