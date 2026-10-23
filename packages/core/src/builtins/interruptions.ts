import { standard } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Plugin } from "../contract/plugin.ts";

/** The host setting that keeps a cut-off response's text and asks the model to continue it, read by `retry` in turn.ts. */
export const CONTINUE_INTERRUPTED = "continueInterrupted";

export const interruptionsPlugin: Plugin<"core"> = {
  id: "interruptions",
  contribute: {
    settings: [
      {
        id: CONTINUE_INTERRUPTED,
        label: "Continue cut-off responses",
        schema: standard(Type.Boolean()),
        default: true,
        scope: "host",
      },
    ],
  },
};
