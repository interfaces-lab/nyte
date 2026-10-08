import { stylex } from "@nyte-ai/ui/stylex";
import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig } from "vite";
import { dropInlinedGhosttyWasm } from "./vite.ts";

/** The browser build of the interface: `index.html` mounts `src/web/entry.tsx`. */
export default defineConfig(() => ({
  plugins: [
    dropInlinedGhosttyWasm(),
    stylex.vite({
      useCSSLayers: true,
      // Older targets make lightningcss polyfill the tokens' light-dark() and
      // relative colours with variables nothing defines.
      lightningcssOptions: { targets: { chrome: 123 << 16 } },
    }),
    react({ compiler: true }),
  ],
  optimizeDeps: { exclude: ["@nyte-ai/ui"], include: ["react", "react-dom/client"] },
  /* StyleX compiles @nyte-ai/ui from source here, so resolve its `nyte-source` condition. */
  resolve: {
    conditions: ["nyte-source", ...defaultClientConditions],
    dedupe: ["react", "react-dom"],
  },
  build: { chunkSizeWarningLimit: 6_000 },
  server: { port: 5179, strictPort: true, forwardConsole: true },
}));
