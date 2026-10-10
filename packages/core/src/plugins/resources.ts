import { standard } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Plugin } from "../plugin.ts";

/** Contributes what core scanned for a session (decision 13, from `api.inputs`): the prompt section `project-context` (order 10), the context files in prompt order, each headed by its path, left out when there are none; the prompt section `skills` (order 90), one line per model-invocable skill with its name, description and location, left out when there are none; `contribute.skills` derived each reload from `Resources.skills`, each skill's `load()` reading its `location` through `inputs.project` for a project skill and `inputs.user` otherwise; and the host setting `skills.paths`, the extra skill directories and `.md` files `scanResources` reads. */
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
    throw new Error("not implemented");
  },
};
