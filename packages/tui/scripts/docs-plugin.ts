import { readCheckoutDocs } from "@nyte-ai/service/docs";
import type { DocsSource } from "@nyte-ai/service/docs";
import type { BunPlugin } from "bun";

export const docsPlugin = {
  name: "nyte:docs",
  setup(build) {
    build.onLoad({ filter: /[/\\]docs-files\.ts$/ }, () => ({
      contents: `export default ${JSON.stringify({ kind: "files", files: readCheckoutDocs() } satisfies DocsSource)};`,
      loader: "js",
    }));
  },
} satisfies BunPlugin;
