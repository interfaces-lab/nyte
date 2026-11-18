import { transform } from "sucrase";
import { BOARD_GLOBAL, spanKey } from "@nyte-ai/plugin/design/board-protocol";
import type { AppMessage } from "@nyte-ai/plugin/design/board-protocol";
import { parseDesign } from "./design-source.ts";
import type { DesignSource } from "./design-source.ts";
import type { Designs } from "./designs.ts";

export type BoardLoad = Extract<AppMessage, { kind: "load" }>;

interface File {
  readonly path: string;
  readonly text: string;
  readonly source: DesignSource;
}

const compiled = new Map<string, { readonly text: string; readonly body: string }>();

/**
 * Turns the workspace's designs into what the board runs: one script holding every `.jsx` file as a module, each JSX
 * element stamped with `data-src="path:start:end"` (its range in the file as written), and the facts the board needs to
 * know what it may edit. Compiling only rewrites text; the designs run in the board's sandbox, never here.
 */
export async function buildBoard(designs: Designs): Promise<BoardLoad> {
  const files = (
    await Promise.all(
      designs.paths
        .filter((path) => path.endsWith(".jsx"))
        .map(async (path): Promise<File | undefined> => {
          const text = designs.texts.get(path);

          return text === undefined
            ? undefined
            : { path, text, source: await parseDesign(path, text) };
        }),
    )
  ).filter((file) => file !== undefined);

  const styles = designs.paths.flatMap((path) => {
    const text = designs.texts.get(path);

    return path.endsWith(".css") && text !== undefined ? [{ path, text }] : [];
  });

  const imports = new Map(
    files.map((file) => [
      file.path,
      file.source.imports
        .filter((specifier) => specifier.startsWith("./") || specifier.startsWith("../"))
        .map((specifier) => resolvePath(file.path, specifier)),
    ]),
  );

  return {
    kind: "load",
    code: bundle(
      files.map((file) => ({ path: file.path, body: compileFile(file) })),
      styles.map((style) => style.path),
    ),
    sheets: files
      .filter((file) => file.source.sheet)
      .map((file) => ({ path: file.path, reads: readGraph(file.path, imports) })),
    styles,
    texts: files.flatMap((file) =>
      file.source.elements
        .filter((element) => element.host && element.words !== null)
        .map((element) => spanKey({ path: file.path, start: element.start, end: element.end })),
    ),
    frames: files.flatMap((file) =>
      file.source.elements
        .filter((element) => element.frame)
        .map((element) => ({
          key: spanKey({ path: file.path, start: element.start, end: element.end }),
          movable: element.x !== null && element.y !== null,
          pinned: element.pinned,
        })),
    ),
  };
}

function resolvePath(from: string, specifier: string): string {
  const parts = from.split("/").slice(0, -1);

  for (const part of specifier.split("/")) {
    if (part === "" || part === ".") continue;

    if (part === "..") parts.pop();
    else parts.push(part);
  }

  return parts.join("/");
}

function readGraph(start: string, imports: ReadonlyMap<string, readonly string[]>): string[] {
  const seen = [start];

  for (const path of seen)
    for (const next of imports.get(path) ?? []) if (!seen.includes(next)) seen.push(next);

  return seen;
}

function compileFile(file: File): string {
  const known = compiled.get(file.path);

  if (known?.text === file.text) return known.body;

  const stamped = file.source.elements
    .toSorted((left, right) => right.stampAt - left.stampAt)
    .reduce(
      (text, element) =>
        `${text.slice(0, element.stampAt)} data-src={${JSON.stringify(
          spanKey({ path: file.path, start: element.start, end: element.end }),
        )}}${text.slice(element.stampAt)}`,
      file.text,
    );

  const body = compileText(file.path, stamped);
  compiled.set(file.path, { text: file.text, body });

  return body;
}

function compileText(path: string, text: string): string {
  try {
    return transform(text, {
      transforms: ["jsx", "imports"],
      jsxRuntime: "automatic",
      production: true,
      filePath: path,
    }).code;
  } catch (error) {
    const message =
      error instanceof Error ? error.message.replace(/^Error transforming /u, "") : String(error);

    return `throw new Error(${JSON.stringify(message)});`;
  }
}

function bundle(
  files: readonly { readonly path: string; readonly body: string }[],
  styles: readonly string[],
): string {
  return [
    "(() => {",
    `const __board = globalThis.${BOARD_GLOBAL};`,
    `const __styles = new Set(${JSON.stringify(styles)});`,
    "const __files = {",
    ...files.map(
      (file) => `${JSON.stringify(file.path)}: function (exports, require) {\n${file.body}\n},`,
    ),
    "};",
    "const __modules = new Map();",
    "function __resolve(from, specifier) { const parts = from.split('/').slice(0, -1); for (const part of specifier.split('/')) { if (part === '' || part === '.') continue; if (part === '..') parts.pop(); else parts.push(part); } return parts.join('/'); }",
    "function __load(from) { return (specifier) => { if (specifier === 'react') return __board.react; if (specifier === 'react/jsx-runtime') return __board.jsxRuntime; if (!specifier.startsWith('./') && !specifier.startsWith('../')) throw new Error(from + ' imports ' + JSON.stringify(specifier) + ': a design imports react and its own .jsx and .css files, nothing else.'); const name = __resolve(from, specifier); if (name.endsWith('.css')) { if (!__styles.has(name)) throw new Error(from + ' imports ' + specifier + ', which is not a stylesheet under design/.'); __board.style(name); return {}; } return __require(name); }; }",
    "function __require(name) { if (!Object.hasOwn(__files, name)) throw new Error(name + ' is not a design file.'); const known = __modules.get(name); if (known !== undefined) return known; const exports = {}; __modules.set(name, exports); try { __files[name](exports, __load(name)); } catch (error) { __modules.delete(name); throw error; } return exports; }",
    "__board.define(__require);",
    "})();",
    "",
  ].join("\n");
}
