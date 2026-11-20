import type { Plugin } from "../contract/plugin.ts";

export const CONTINUE_INTERRUPTED = "continueInterrupted";

export const interruptionsPlugin: Plugin<"core"> = {
  id: "interruptions",
  contribute: {
    settings: [
      {
        id: CONTINUE_INTERRUPTED,
        title: "Continue cut-off responses",
        type: "switch",
        default: true,
      },
    ],
  },
};
