import type { Plugin } from "../contract/plugin.ts";

export const systemPromptPlugin: Plugin<"core"> = {
  id: "system-prompt",
  contribute: {
    prompt: [
      {
        id: "system-prompt",
        order: 0,
        text: "You are a coding agent running inside Nyte, working in the user's workspace.",
      },
    ],
  },
};
