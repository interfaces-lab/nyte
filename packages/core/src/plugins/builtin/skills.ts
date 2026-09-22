/**
 * Offer a discovered skill catalog to the model: the listing in the prompt, the
 * bodies on demand. Discovery belongs to whoever composes the plugin, so an
 * unchanged catalog keeps the same plugin version and never reactivates.
 */
import { formatSkillsForPrompt } from "./skills-index.ts";
import type { LoadedSkills } from "./skills-index.ts";
import { definePlugin } from "../types.ts";

export const SKILLS_PLUGIN_ID = "skills";

export function skillsPlugin(loaded: LoadedSkills) {
  return definePlugin({
    id: SKILLS_PLUGIN_ID,
    session(api) {
      for (const diagnostic of loaded.diagnostics) {
        api.diagnostics.warn(`${diagnostic.path}: ${diagnostic.message}`);
      }

      api.resources.add((draft) => {
        for (const skill of loaded.skills) {
          if (!draft.has(skill.name)) draft.set(skill.name, skill);
        }
      });
      const catalog = formatSkillsForPrompt(loaded.skills);

      if (catalog !== "") {
        api.prompt.add((draft) => draft.set("available-skills", { text: catalog, order: 90 }));
      }
    },
  });
}
