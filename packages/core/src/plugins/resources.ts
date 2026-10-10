import { standard } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Resources } from "../environment.ts";
import { SdkError } from "../error.ts";
import type { Plugin, PluginApi } from "../plugin.ts";
import { resourceIssues } from "../resources.ts";

/** Contributes what core scanned for a session (decision 13, from `api.inputs`): the prompt section `project-context` (order 10), the context files in prompt order, each headed by its path, left out when there are none; the prompt section `skills` (order 90), one line per skill with its name, description and location, left out when there are none; `contribute.skills` derived each reload from `Resources.skills`, each skill's `load()` reading its `location` through `inputs.project` for a project skill and `inputs.user` otherwise; the scan's duplicate-skill warnings reported on this plugin's row; and the host setting `skills.paths`, the extra skill directories and `.md` files `scanResources` reads. Without scanned resources it contributes nothing but the setting. */
export const resourcesPlugin: Plugin<"core"> = {
  id: "resources",
  contribute: {
    settings: [
      {
        id: "skills.paths",
        label: "Skill paths",
        schema: standard(Type.Array(Type.String())),
        default: [],
        scope: "host",
      },
    ],
  },
  activate(api) {
    const inputs = inputsOf(api);

    if (inputs === null) return;

    for (const issue of resourceIssues(inputs)) api.report(issue);

    if (inputs.contextFiles.length > 0)
      api.contribute.prompt.add({
        id: "project-context",
        order: 10,
        text: [
          "Instructions from the user and the project, in order; later files are more specific:",
          ...inputs.contextFiles.map((file) => `# ${file.path}\n\n${file.content.trim()}`),
        ].join("\n\n"),
      });

    if (inputs.skills.length > 0)
      api.contribute.prompt.add({
        id: "skills",
        order: 90,
        text: [
          "Skills: read a skill's file when its description matches the task.",
          ...inputs.skills.map(
            (skill) =>
              `- ${skill.name}: ${skill.description === "" ? "(no description)" : skill.description} (${skill.scope === "user" ? `~/${skill.location}` : skill.location})`,
          ),
        ].join("\n"),
      });

    api.contribute.skills.add((draft) => {
      for (const skill of inputs.skills)
        draft.set(skill.name, {
          name: skill.name,
          description: skill.description,
          location: skill.location,
          load: () => loadSkill(inputs, skill),
        });
    });
  },
};

/** Returns the plugin's scanned resources, or null when the session has none. */
function inputsOf(api: PluginApi<"core">): Resources | null {
  try {
    return api.inputs;
  } catch {
    return null;
  }
}

/** Reads a skill's file through the files of its scope: the project's for a project skill, the user's otherwise. */
async function loadSkill(inputs: Resources, skill: Resources["skills"][number]): Promise<string> {
  const files = skill.scope === "project" ? inputs.project : inputs.user;

  if (files === null)
    throw new SdkError("unavailable", `The ${skill.scope} files of skill ${skill.name} are gone.`);
  const document = await files.read(skill.location);

  if (document.kind !== "text")
    throw new SdkError("unknown", `Skill ${skill.name} has no text at ${skill.location}.`);

  return document.contents;
}
