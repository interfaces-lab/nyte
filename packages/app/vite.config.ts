import { stylex } from "@nyte-ai/ui/stylex";
import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig } from "vite";
import { deferredEntries } from "./src/deferred-entries.ts";
import {
  canvasShell,
  deferredChunks,
  devConsole,
  dropInlinedGhosttyWasm,
  shareCentralIconBase,
} from "./vite.ts";

/**
 * The browser build of the interface: `index.html` mounts `src/web/entry.tsx`.
 * StyleX compiles @nyte-ai/ui from source here, so it resolves the
 * `nyte-source` condition. An older lightningcss target would polyfill the
 * tokens' light-dark() and relative colours with variables nothing defines.
 */
export default defineConfig({
  plugins: [
    deferredChunks(deferredEntries),
    shareCentralIconBase(),
    dropInlinedGhosttyWasm(),
    canvasShell(),
    devConsole(),
    stylex.vite({
      useCSSLayers: true,
      lightningcssOptions: { targets: { chrome: 123 << 16 } },
    }),
    react({ compiler: true }),
  ],
  optimizeDeps: { exclude: ["@nyte-ai/ui"], include: ["react", "react-dom/client"] },
  resolve: {
    conditions: ["nyte-source", ...defaultClientConditions],
    dedupe: ["react", "react-dom"],
  },
  build: { chunkSizeWarningLimit: 6_000 },
  server: { port: 5179, strictPort: true, forwardConsole: true },
});
