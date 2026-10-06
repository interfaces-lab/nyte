import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { build, transformWithOxc } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));

let runtime: Promise<string> | undefined;

export function buildRuntime(): Promise<string> {
  runtime ??= (async () => {
    const result = await build({
      configFile: false,
      root,
      logLevel: "silent",
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
      // The dev server's NODE_ENV would otherwise compile JSX to jsxDEV, which production React lacks.
      oxc: { jsx: { runtime: "automatic", development: false } },
      build: {
        write: false,
        minify: true,
        lib: {
          entry: `${root}src/canvas/runtime.tsx`,
          name: "NyteCanvasRuntime",
          formats: ["iife"],
        },
      },
    });

    const outputs = Array.isArray(result) ? result : [result];

    for (const output of outputs) {
      if (!("output" in output)) continue;

      for (const item of output.output) if (item.type === "chunk") return item.code;
    }

    throw new Error("The canvas runtime produced no script.");
  })().catch((cause: unknown) => {
    runtime = undefined;
    throw cause;
  });

  return runtime;
}

export async function compileCanvas(source: string): Promise<string> {
  try {
    return await compileModule(source);
  } catch (cause) {
    const message = stripVTControlCharacters(cause instanceof Error ? cause.message : String(cause))
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("at "))
      .join("\n")
      .trim();

    throw new Error(`${message}\nFix the indicated line and call canvas again.`, { cause });
  }
}

async function compileModule(source: string): Promise<string> {
  if (source.length > 100_000)
    throw new Error("Line 1: keep canvas source below 100,000 characters.");

  const transformed = await transformWithOxc(source, "canvas.tsx", {
    jsx: {
      runtime: "classic",
      pragma: "window.NyteCanvas.React.createElement",
      pragmaFrag: "window.NyteCanvas.React.Fragment",
    },
  });

  const result = await build({
    configFile: false,
    root,
    logLevel: "silent",
    plugins: [
      {
        name: "canvas-module",
        resolveId(id) {
          if (id === "canvas.tsx" || id === `${root}canvas.tsx`) return "\0canvas.tsx";

          if (id === "react" || id === "nyte:canvas") return { id, external: true };
          const line = source.split("\n").findIndex((text) => text.includes(id)) + 1;
          throw new Error(
            `Line ${Math.max(1, line)}: import '${id}' is not allowed. Import only 'react' or 'nyte:canvas'.`,
          );
        },
        resolveDynamicImport() {
          throw new Error(
            "Line 1: dynamic imports are not supported. Use top-level imports from 'react' or 'nyte:canvas'.",
          );
        },
        load(id) {
          if (id !== "\0canvas.tsx") return undefined;
          const ast = this.parse(source, { lang: "tsx", sourceType: "module" });

          for (const node of ast.body) {
            if (
              node.type !== "ImportDeclaration" &&
              node.type !== "ExportNamedDeclaration" &&
              node.type !== "ExportAllDeclaration"
            )
              continue;

            if (node.source === null || node.source === undefined) continue;
            const name = node.source.value;

            if (name !== "react" && name !== "nyte:canvas") {
              const line = source.slice(0, node.start).split("\n").length;
              throw new Error(
                `Line ${line}: import '${name}' is not allowed. Import only 'react' or 'nyte:canvas'.`,
              );
            }
          }

          return transformed.code;
        },
      },
    ],
    build: {
      write: false,
      minify: false,
      lib: { entry: "canvas.tsx", name: "NyteCanvasModule", formats: ["iife"] },
      rolldownOptions: {
        output: {
          exports: "named",
          globals: {
            react: "NyteCanvas.React",
            "react/jsx-runtime": "NyteCanvas.jsxRuntime",
            "nyte:canvas": "NyteCanvas.sdk",
          },
        },
      },
    },
  });

  const outputs = Array.isArray(result) ? result : [result];

  for (const output of outputs) {
    if (!("output" in output)) continue;

    for (const item of output.output) {
      if (item.type !== "chunk") continue;

      if (!item.exports.includes("default"))
        throw new Error(
          "Line 1: add a default export, for example: export default function Canvas() { return <div />; }",
        );

      return `${item.code}\nwindow.NyteCanvasModule = NyteCanvasModule;`;
    }
  }

  throw new Error("Line 1: the compiler produced no canvas. Export a default React component.");
}
