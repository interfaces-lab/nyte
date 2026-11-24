import { readFile } from "node:fs/promises";
import { assertSingleFilePartView, partViewFiles } from "@nyte-ai/plugin/part-view-files";
import type { BunPlugin } from "bun";

export const partViewsPlugin = {
  name: "nyte:part-views",
  setup(build) {
    build.onLoad({ filter: /\.view\.tsx$/ }, async (args) => {
      const contents = await readFile(args.path);
      await assertSingleFilePartView(args.path, contents.toString("utf8"));

      return { contents, loader: "file" };
    });

    build.onLoad({ filter: /[/\\]plugin[/\\]src[/\\].+\.ts$/ }, async (args) => {
      const code = await readFile(args.path, "utf8");
      const views = partViewFiles(code, args.path);

      if (views.length === 0) return { contents: code, loader: "ts" };

      const imports = views.map(
        (view, index) =>
          `import partView${index} from ${JSON.stringify(view.path)} with { type: "file" };`,
      );

      const rewritten = views.reduce(
        (text, view, index) => text.replace(view.expression, `partViewUrl(partView${index})`),
        code,
      );

      return {
        contents: [
          'import { pathToFileURL as partViewUrl } from "node:url";',
          ...imports,
          rewritten,
        ].join("\n"),
        loader: "ts",
      };
    });
  },
} satisfies BunPlugin;
