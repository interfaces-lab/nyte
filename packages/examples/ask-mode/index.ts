import type { Plugin } from "@nyte-ai/plugin/core";

const ASK = "mode.ask";

export default {
  id: "ask-mode",
  contribute: {
    settings: [
      {
        id: ASK,
        title: "Ask",
        description: "Answers questions about the code without changing anything.",
        type: "switch",
        scope: "chat",
        mode: {
          icon: "bubble-question",
          color: "oklch(0.68 0.12 230)",
        },
      },
    ],
    prompt: [
      {
        id: ASK,
        delivery: "reminder",
        when: (chat) => chat.settings[ASK] === true,
        text: "Ask mode is on.\n\nAnswer the user's questions about the code. Read and search files, and back each answer with paths and lines. Don't edit files or run commands. When the answer is a change, describe it, and the user switches modes to make it.",
        gone: "Ask mode is off. Its instructions no longer apply.",
      },
    ],
  },
  hooks: {
    async before_tool(call, context) {
      if (call.class.kind !== "edit" && call.class.kind !== "shell") return { action: "continue" };

      if ((await context.api.registries.settings.value(ASK)) !== true) {
        return { action: "continue" };
      }

      return {
        action: "reject",
        reason: "Ask mode doesn't change files or run commands. Describe the change instead.",
      };
    },
  },
} satisfies Plugin;
