/**
 * An optional `description` argument on the `bash` tool. The model names what
 * a command does in a few words, and `present` carries that through the
 * shell class, so a client can head the call with the description and keep
 * the command as the detail, the way Cursor shows "Ran <description>". Core's
 * bash is wrapped as the registry hands it over: its execute, replay, output
 * schema, wording, and the facts its own `present` measures stay; only the
 * parameters change and `present` adds the description.
 */
import { definePlugin } from "@nyte-ai/plugin";
import { IsObject, IsString, Type } from "typebox";

export const BASH_DESCRIPTION_PLUGIN_ID = "bash-description";

export const bashDescriptionParameter = Type.Optional(
  Type.String({
    description:
      "Clear, concise description of what this command does in 5-10 words, in active voice",
  }),
);

export const bashDescriptionPlugin = definePlugin({
  id: BASH_DESCRIPTION_PLUGIN_ID,
  session(api) {
    api.tools.add((tools) => {
      const bash = tools.get("bash");

      if (bash === undefined || !IsObject(bash.parameters)) return;
      const { command } = bash.parameters.properties;

      if (!IsString(command)) return;
      tools.set("bash", {
        ...bash,
        parameters: Type.Object({
          ...bash.parameters.properties,
          command,
          description: bashDescriptionParameter,
        }),
        present: (args, context, result) => {
          const presented = bash.present?.(args, context, result);
          const shell =
            presented?.kind === "shell"
              ? presented
              : { kind: "shell" as const, command: args.command };
          const description = args.description?.trim() ?? "";

          return description === "" ? shell : { ...shell, description };
        },
      });
    });
  },
});

export default bashDescriptionPlugin;
