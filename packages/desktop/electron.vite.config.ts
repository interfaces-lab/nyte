import react from "@vitejs/plugin-react";
import { defineConfig, MainConfigFactory } from "electron-vite";
import type { UserConfig } from "electron-vite";
import { readFile } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { resolvePhotonWasmPath } from "@nyte-ai/host/images";
import { resolveQuickJSWasmPath } from "@nyte-ai/plugin/core/codemode-runtime";
import { assertSingleFilePartView, partViewFiles } from "@nyte-ai/plugin/part-view-files";
import { build, defaultClientConditions } from "vite";
import type { Plugin } from "vite";
import { deferredEntries } from "@nyte-ai/app/lib/deferred-entries.ts";
import packageMetadata from "./package.json" with { type: "json" };
import {
  deferredChunks,
  fileStructureLicenses,
  shareCentralIconBase,
  stylex,
  trimStreamdown,
} from "@nyte-ai/app/vite";

const renderer = {
  plugins: [
    deferredChunks({
      ...deferredEntries,
      account: {
        module: new URL("./src/renderer/src/account/clerk.tsx", import.meta.url).href,
        packages: ["@clerk/"],
      },
    }),
    shareCentralIconBase(),
    trimStreamdown(),
    fileStructureLicenses(),
    stylex.vite({
      useCSSLayers: true,
      lightningcssOptions: { targets: { chrome: 152 << 16 } },
    }),
    react({ compiler: true }),
    {
      name: "nyte:serve-devtools",
      apply: "serve",
      transformIndexHtml: () => [
        {
          tag: "script",
          attrs: { type: "module", src: "/src/devtools.tsx" },
          injectTo: "body",
        },
      ],
    } satisfies Plugin,
  ],
  optimizeDeps: {
    exclude: ["@nyte-ai/ui", "@nyte-ai/app"],
    include: ["react", "react-dom/client"],
  },
  resolve: {
    conditions: ["nyte-source", ...defaultClientConditions],
    dedupe: ["react", "react-dom"],
  },
  build: {
    chunkSizeWarningLimit: 6000,
    manifest: true,
    minify: true,
    target: "chrome152",
    rolldownOptions: {
      input: { index: resolve("src/renderer/index.html") },
    },
  },
  server: { host: "127.0.0.1", port: 5174, strictPort: true, forwardConsole: true },
} satisfies UserConfig["renderer"];

const MAIN_ENTRIES = {
  index: resolve("src/main/index.ts"),
  "usage-worker": resolve("src/workers/usage-worker.ts"),
};

const HOST_ENTRIES = {
  "nyte-host": resolve("src/workers/nyte-host.ts"),
  "host-worker": resolve("src/workers/host-worker.ts"),
  "codemode-worker": resolve("src/workers/codemode-worker.ts"),
  "image-worker": resolve("src/workers/image-worker.ts"),
};

const PART_VIEW_TOKEN = "nyte-part-view:";

function partViews(): Plugin {
  const emitted = new Set<string>();

  return {
    name: "nyte:part-views",
    async transform(code, id) {
      if (id.includes("?")) return null;

      const views = partViewFiles(code, id);

      if (views.length === 0) return null;

      const references = await Promise.all(
        views.map(async (view) => {
          const source = await readFile(view.path, "utf8");
          await assertSingleFilePartView(view.path, source);

          const reference = this.emitFile({
            type: "asset",
            name: basename(view.path),
            source,
          });

          emitted.add(reference);

          return { view, reference };
        }),
      );

      return {
        code: references.reduce(
          (text, entry) =>
            text.replace(
              entry.view.expression,
              `new URL("${PART_VIEW_TOKEN}${entry.reference}", import.meta.url)`,
            ),
          code,
        ),
        map: null,
      };
    },
    renderChunk(code, chunk) {
      if (!code.includes(PART_VIEW_TOKEN)) return null;

      return {
        code: [...emitted].reduce((text, reference) => {
          const target = relative(dirname(chunk.fileName), this.getFileName(reference)).replaceAll(
            "\\",
            "/",
          );

          const specifier =
            target.startsWith("./") || target.startsWith("../") ? target : `./${target}`;

          const token = `${PART_VIEW_TOKEN}${reference}`;
          const quoted = JSON.stringify(specifier);

          return text.replaceAll(`"${token}"`, quoted).replaceAll(`'${token}'`, quoted);
        }, code),
        map: null,
      };
    },
  };
}

const main = (mode: string, host: boolean) =>
  ({
    define: {
      NYTE_BUILT_VERSION: JSON.stringify(
        process.env["NYTE_RELEASE_VERSION"] ?? packageMetadata.version,
      ),
      NYTE_BUILT_CONNECT_ORIGIN: JSON.stringify(process.env["NYTE_CONNECT_ORIGIN"] ?? ""),
      NYTE_BUILT_METRICS_ORIGIN: JSON.stringify(process.env["NYTE_METRICS_ORIGIN"] ?? ""),
    },
    plugins: host
      ? [
          {
            name: "nyte:codemode-wasm",
            async generateBundle() {
              this.emitFile({
                type: "asset",
                fileName: "quickjs.wasm",
                source: await readFile(resolveQuickJSWasmPath()),
              });
            },
          } satisfies Plugin,
          partViews(),
          {
            name: "nyte:photon-wasm",
            async generateBundle() {
              this.emitFile({
                type: "asset",
                fileName: "photon_rs_bg.wasm",
                source: await readFile(resolvePhotonWasmPath()),
              });
            },
          } satisfies Plugin,
        ]
      : [
          {
            name: "nyte:host",
            apply: "build",
            async closeBundle() {
              await build(
                await new MainConfigFactory(
                  main(mode, true),
                  { mode, configFile: false },
                  {},
                ).build(),
              );
            },
          } satisfies Plugin,
        ],
    resolve: { alias: { fflate: "fflate/browser" } },
    build: {
      ...(mode === "e2e" ? { outDir: "out-e2e/main" } : {}),
      emptyOutDir: !host,
      externalizeDeps: { exclude: ["@clerk/electron"] },
      minify: true,
      target: "node24",
      rolldownOptions: {
        input: host ? HOST_ENTRIES : MAIN_ENTRIES,
        output: {
          entryFileNames: "[name].js",
          chunkFileNames: host ? "host-chunks/[name].js" : "chunks/[name].js",
        },
      },
    },
  }) satisfies UserConfig["main"];

const config = (mode: string): UserConfig => ({
  main: main(mode, false),
  preload: {
    build: {
      externalizeDeps: false,
      minify: true,
      target: "node24",
      rolldownOptions: {
        input: {
          index: resolve("src/preload/index.ts"),
          "browser-page": resolve("src/preload/browser-page.ts"),
          "canvas-preview": resolve("src/preload/canvas-preview.ts"),
        },
        treeshake: { moduleSideEffects: false },
        output: { format: "cjs", entryFileNames: "[name].js" },
      },
    },
  },
  renderer,
});

export default defineConfig(({ mode }) => {
  const { main, ...rest } = config(mode);

  return mode === "e2e" ? { main } : { main, ...rest };
});
