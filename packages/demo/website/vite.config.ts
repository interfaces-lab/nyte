import stylex from "@stylexjs/unplugin";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import { defaultClientConditions, defaultServerConditions, defineConfig } from "vite";

export default defineConfig({
  plugins: [
    stylex.vite({
      useCSSLayers: true,
      lightningcssOptions: {
        targets: {
          chrome: 123 << 16,
          edge: 123 << 16,
          firefox: 120 << 16,
          safari: (17 << 16) | (5 << 8),
        },
      },
    }),
    tanstackStart({ srcDirectory: "src" }),
    react({ compiler: true }),
    tailwindcss(),
    nitro(),
  ],
  optimizeDeps: { exclude: ["@nyte-ai/ui"] },
  resolve: {
    conditions: ["nyte-source", ...defaultClientConditions],
    dedupe: ["react", "react-dom"],
  },
  ssr: { resolve: { conditions: ["nyte-source", ...defaultServerConditions] } },
  server: {
    port: 5174,
    strictPort: true,
  },
  preview: {
    port: 5174,
    strictPort: true,
  },
});
