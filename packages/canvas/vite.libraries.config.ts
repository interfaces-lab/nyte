import { CANVAS_GLOBAL, LIBRARY_VERSIONS } from "@nyte-ai/plugin/canvas/protocol";
import { defineConfig } from "vite";
import type { Plugin } from "vite";

const SHELL_MODULES = new Map([
  ["react", "react"],
  ["react/jsx-runtime", "jsxRuntime"],
  ["react-dom", "reactDom"],
]);

const PREFIX = "\0canvas-shell:";

function shellModules(): Plugin {
  return {
    name: "canvas-shell-modules",
    enforce: "pre",
    resolveId: (id) => (SHELL_MODULES.has(id) ? `${PREFIX}${id}` : undefined),
    load: async (id) => {
      if (!id.startsWith(PREFIX)) return undefined;
      const specifier = id.slice(PREFIX.length);
      const module: object = await import(specifier);
      const names = Object.keys(module).filter(
        (name) => name !== "default" && /^[A-Za-z_$][\w$]*$/u.test(name),
      );

      return [
        `const shell = globalThis.${CANVAS_GLOBAL}.${String(SHELL_MODULES.get(specifier))};`,
        "export default shell;",
        `export const { ${names.join(", ")} } = shell;`,
      ].join("\n");
    },
  };
}

export default defineConfig({
  plugins: [shellModules()],
  build: {
    outDir: "dist/shell/libraries",
    emptyOutDir: true,
    target: ["chrome123", "safari16.4"],
    minify: true,
    modulePreload: false,
    chunkSizeWarningLimit: 1_000,
    rolldownOptions: {
      input: Object.fromEntries(Object.keys(LIBRARY_VERSIONS).map((name) => [name, name])),
      preserveEntrySignatures: "strict",
      output: {
        format: "es",
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
      },
    },
  },
});
