import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { files } from "@nyte-ai/canvas/shell-files";
import type { BunPlugin } from "bun";

/**
 * Embeds the canvas shell's files in the binary as files rather than as the base64 strings
 * `@nyte-ai/canvas/shell-files` holds, and reads each one when the canvas previewer serves it. The
 * build fails unless the embedded files are exactly the ones that module lists, byte for byte.
 */
export const canvasShellPlugin = {
  name: "nyte:canvas-shell",
  setup(build) {
    build.onLoad({ filter: /[/\\]canvas[/\\]dist[/\\]shell-files\.js$/ }, (args) => {
      const shell = join(dirname(args.path), "shell");

      const paths = readdirSync(shell, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => join(entry.parentPath, entry.name))
        .toSorted();

      const names = paths.map((path) => relative(shell, path).split(sep).join("/"));
      const listed = Object.keys(files).toSorted();

      if (names.join("\n") !== listed.join("\n"))
        throw new Error(`${shell} doesn't hold the files ${args.path} lists. Rebuild the canvas.`);

      for (const [index, path] of paths.entries())
        if (readFileSync(path).toString("base64") !== files[names[index] ?? ""])
          throw new Error(`${path} differs from ${args.path}. Rebuild the canvas.`);

      const imports = paths.map(
        (path, index) =>
          `import file${String(index)} from ${JSON.stringify(path)} with { type: "file" };`,
      );

      const entries = names.map(
        (name, index) =>
          `[${JSON.stringify(name)}, { enumerable: true, get: () => readFileSync(file${String(index)}).toString("base64") }]`,
      );

      return {
        contents: [
          'import { readFileSync } from "node:fs";',
          ...imports,
          `export const files = Object.defineProperties({}, Object.fromEntries([\n${entries.join(",\n")}\n]));`,
        ].join("\n"),
        loader: "js",
      };
    });
  },
} satisfies BunPlugin;
