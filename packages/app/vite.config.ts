import { stylex } from "@nyte-ai/ui/stylex";
import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig } from "vite";
import { deferredEntries } from "./src/lib/deferred-entries.ts";
import { canvasShell, deferredChunks, devConsole, shareCentralIconBase } from "./vite.ts";

export default defineConfig({
  plugins: [
    deferredChunks(deferredEntries),
    shareCentralIconBase(),
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
