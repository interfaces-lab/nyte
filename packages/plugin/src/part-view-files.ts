import { dirname, resolve } from "node:path";

const VIEW_URL = /new URL\("(\.\/[^"]+\.view\.tsx)", import\.meta\.url\)/gu;

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
  return [...code.matchAll(VIEW_URL)].flatMap((match) =>
    match[1] === undefined
      ? []
      : [{ expression: match[0], path: resolve(dirname(module), match[1]) }],
  );
}
