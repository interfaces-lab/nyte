import type { PromptSection, SettingDefinition, When } from "@nyte-ai/core";
import type { Command, Plugin } from "@nyte-ai/plugin/core";
import autoresearch from "./autoresearch/autoresearch.ts";
import debug from "./debug/debug.ts";
import type { Mode } from "./mode.ts";

const MODES: readonly Mode[] = [debug, autoresearch];

function on(mode: Mode): When {
  return (chat) => chat.settings[mode.id] === true;
}

export default {
  id: "modes",
  contribute: {
    settings: MODES.map(
      (mode) =>
        ({
          id: mode.id,
          title: mode.title,
          description: mode.description,
          type: "switch",
          scope: "chat",
          mode: { icon: mode.icon, color: mode.color },
        }) satisfies SettingDefinition,
    ),
    prompt: MODES.map(
      (mode) =>
        ({
          id: mode.id,
          delivery: "reminder",
          when: on(mode),
          text: `${mode.title} mode is on.\n\n${mode.prompt}`,
          gone: `${mode.title} mode is off. Its instructions no longer apply.`,
        }) satisfies PromptSection,
    ),
    tools: MODES.flatMap((mode) =>
      (mode.tools ?? []).map((tool) => ({
        ...tool,
        when: on(mode),
      })),
    ),
    parts: MODES.flatMap((mode) => mode.parts ?? []),
    commands: MODES.flatMap((mode) => [mode.toggle ?? toggle(mode), ...(mode.commands ?? [])]),
  },
  hooks: {
    async run_ended(end, context) {
      for (const mode of MODES) await mode.onRunEnded?.(end, context);
    },
  },
} satisfies Plugin;

function toggle(mode: Mode): Command<"core"> {
  return {
    name: mode.name,
    title: mode.title,
    description: `Turn ${mode.title} mode on or off`,
    async run(text, { api }) {
      const turnsOn = (await api.registries.settings.value(mode.id)) !== true;
      await api.registries.settings.set(mode.id, turnsOn);

      return turnsOn && text !== "" ? { prompt: text } : undefined;
    },
  };
}
