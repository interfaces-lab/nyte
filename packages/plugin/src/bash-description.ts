import { standard } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Plugin } from "./core.ts";

const parameters = standard(
  Type.Object({
    command: Type.String({ description: "The shell command to run." }),
    description: Type.String({
      description:
        "Clear, concise description of what this command does in 5-10 words, in active voice.",
    }),
  }),
);

/**
 * Makes the model say what each `bash` call does. A derive wraps the
 * environment's `bash` tool, keeping its identity, execute and class, and
 * requires `description` in its parameters; the tool's class already carries
 * it as `ToolClass.shell.description`, so a client heads the call with it.
 *
 * @category plugins
 * @since 0.1.0
 */
export default {
  id: "bash-description",
  activate(api) {
    api.contribute.tools.add((draft) => draft.wrap("bash", (bash) => ({ ...bash, parameters })));
  },
} satisfies Plugin;
