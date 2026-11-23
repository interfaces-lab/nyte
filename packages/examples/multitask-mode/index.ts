import type { Plugin } from "@nyte-ai/plugin/core";

const MULTITASK = "mode.multitask";

export default {
  id: "multitask-mode",
  contribute: {
    commands: [
      {
        name: "multitask",
        title: "Multitask",
        description: "Turn Multitask mode on or off",
        async run(text, { api }) {
          const turnsOn = (await api.registries.settings.value(MULTITASK)) !== true;
          await api.registries.settings.set(MULTITASK, turnsOn);

          return turnsOn && text !== "" ? { prompt: text } : undefined;
        },
      },
    ],
    settings: [
      {
        id: MULTITASK,
        title: "Multitask",
        description:
          "Splits the work into independent pieces and runs them in subagents at the same time.",
        type: "switch",
        scope: "chat",
        mode: {
          icon: "fork",
          color: "oklch(0.62 0.17 290)",
        },
      },
    ],
    prompt: [
      {
        id: MULTITASK,
        delivery: "reminder",
        when: (chat) => chat.settings[MULTITASK] === true,
        text: `Multitask mode is on.

Split the work into independent pieces and run them in subagents at the same time, instead of doing everything in this chat.

- Use task when you need a subagent's answer to go on, and create for work that can run in the background. Start independent subagents in the same response, so they run in parallel.
- A subagent doesn't see this chat. Give each one the goal, the files, the constraints, and what its final message should report.
- When two subagents would edit the same files, give each its own worktree with isolation: "worktree". Turning this mode on is the user asking for that.
- Keep this chat for coordinating: check each result, resolve conflicts, and finish what no subagent can.
- Do small pieces yourself. A subagent is worth it for work that takes more than a few steps.`,
        gone: "Multitask mode is off. Its instructions no longer apply.",
      },
    ],
  },
} satisfies Plugin;
