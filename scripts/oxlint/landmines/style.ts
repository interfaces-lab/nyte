import { definePlugin } from "@oxlint/plugins";

import { noComments } from "./rules/no-comments.ts";

const plugin = definePlugin({
  meta: { name: "landmines-style" },
  rules: {
    "no-comments": noComments,
  },
});

export default plugin;
