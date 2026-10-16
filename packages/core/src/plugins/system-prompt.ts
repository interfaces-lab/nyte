import type { Plugin } from "../plugin.ts";

export const systemPromptPlugin: Plugin<"core"> = {
  id: "system-prompt",
  contribute: {
    prompt: [
      {
        id: "system-prompt",
        order: 0,
        text: "You are a coding agent working in the user's workspace through Nyte. Use the tools you are given to read code, change files and run commands until the task the user asked for is done.",
      },
      {
        id: "rules",
        order: 2,
        text: [
          "- Read the relevant code before changing it, and keep each change to what the task needs.",
          "- Prefer the file tools over shell commands for reading and editing files.",
          "- Leave changes you did not make alone unless asked.",
          "- When you finish, say what you changed and how you checked it; say plainly what failed or was not verified.",
        ].join("\n"),
      },
      {
        id: "docs",
        order: 3,
        text: "Nyte's documentation is at https://nyte.sh/docs. When the user asks how Nyte itself works, read the relevant page instead of guessing.",
      },
    ],
  },
  activate(api) {
    api.contribute.prompt.add((draft, siblings) => {
      const tools = siblings.tools.list();
      const listed = tools.filter((tool) => (tool.exposure ?? "model") === "model");
      const deferred = tools.filter((tool) => tool.exposure === "deferred");

      if (listed.length === 0 && deferred.length === 0) return;

      draft.set("tools", {
        id: "tools",
        order: 1,
        text: [
          "Tools in this session:",
          ...listed.map((tool) => `- ${tool.name}: ${tool.description.split("\n")[0]}`),
          ...(deferred.length === 0
            ? []
            : [`Deferred until activated: ${deferred.map((tool) => tool.name).join(", ")}.`]),
        ].join("\n"),
      });
    });
  },
};
