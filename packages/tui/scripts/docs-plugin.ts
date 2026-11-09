import { readCheckoutDocs } from "@nyte-ai/service/docs";
import type { BunPlugin } from "bun";

export const docsPlugin = {
  name: "nyte:docs",
  setup(build) {
    build.onLoad({ filter: /[/\\]docs-files\.ts$/ }, () => ({
      contents: `export default ${JSON.stringify(readCheckoutDocs())};`,
      loader: "js",
    }));
  },
} satisfies BunPlugin;
