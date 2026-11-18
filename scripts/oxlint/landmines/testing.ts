import { definePlugin } from "@oxlint/plugins";

import { noFixedSleep } from "./rules/no-fixed-sleep.ts";
import { noUnsignaledPoll } from "./rules/no-unsignaled-poll.ts";

const plugin = definePlugin({
  meta: { name: "landmines-testing" },
  rules: {
    "no-fixed-sleep": noFixedSleep,
    "no-unsignaled-poll": noUnsignaledPoll,
  },
});

export default plugin;
