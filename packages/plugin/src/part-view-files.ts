import { dirname, resolve } from "node:path";
import { localImports } from "./canvas/canvas-compile.ts";

const VIEW_FORM = 'new URL("./name.view.tsx", import.meta.url)';

const VIEW_PATH = /^[^\r\n]+\.view\.tsx(?:[?#][^\r\n]*)?$/u;

const VIEW_SCAN =
  /\/\/[^\n]*|\/\*[\s\S]*?\*\/|(new URL\("(\.\/[^"\n\\]+\.view\.tsx)", import\.meta\.url\))|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)/gu;

/**
 * The part views a module points at with `new URL("./name.view.tsx", import.meta.url)`, for a
 * bundler that must ship each file beside its output and rewrite `expression` to point at it.
 *
 * @category plugins
 * @since 0.3.0
 */
export function partViewFiles(
  code: string,
  module: string,
): readonly { readonly expression: string; readonly path: string }[] {
  return [...code.matchAll(VIEW_SCAN)].flatMap((match) => {
    if (match[1] !== undefined && match[2] !== undefined) {
      return [{ expression: match[1], path: resolve(dirname(module), match[2]) }];
    }

    const literal = match[3];

    if (literal !== undefined && VIEW_PATH.test(literal.slice(1, -1))) {
      throw new Error(
        `${module} references ${literal}, which the part-view bundler will not recognise. Write \`${VIEW_FORM}\` on one line with double quotes.`,
      );
    }

    return [];
  });
}

/**
 * Rejects built-in part views with non-type relative imports, because bundled apps ship each view
 * as a single file.
 *
 * @category plugins
 * @since 0.3.0
 */
export async function assertSingleFilePartView(file: string, source: string): Promise<void> {
  const imports = await localImports(file, source);

  if (imports.length === 0) return;

  throw new Error(
    `${file} imports ${imports.join(", ")}. Built-in views ship as a single file; keep relative imports type-only or inline the code.`,
  );
}
