import { readFile, readdir } from "node:fs/promises";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Reads a canvas fixture as `canvas_render` takes it: a `.tsx` file alone,
 * or a folder's `main.tsx` as `source` and every other `.ts`/`.tsx` file
 * under the folder in `files`, keyed by its path from it (`lib/scale.ts`).
 */
export async function readCanvasFixture(
  path: string | URL,
): Promise<{ readonly source: string; readonly files: Readonly<Record<string, string>> }> {
  const root = path instanceof URL ? fileURLToPath(path) : path;

  if (root.endsWith(".tsx")) return { source: await readFile(root, "utf8"), files: {} };
  const names = (await readdir(root, { recursive: true }))
    .map((name) => name.split(sep).join("/"))
    .filter((name) => /\.tsx?$/u.test(name) && name !== "main.tsx")
    .toSorted();

  return {
    source: await readFile(join(root, "main.tsx"), "utf8"),
    files: Object.fromEntries(
      await Promise.all(
        names.map(async (name) => [name, await readFile(join(root, name), "utf8")]),
      ),
    ),
  };
}
