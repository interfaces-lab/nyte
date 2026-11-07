import { bashProperties } from "@nyte-ai/core";
import { standard } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Plugin } from "@nyte-ai/plugin/core";

const parameters = standard(
  Type.Object({
    ...bashProperties,
    description: Type.String({
      description:
        "Clear, concise description of what this command does in 5-10 words, in active voice.",
    }),
  }),
);

export default {
  id: "bash-description",
  activate(api) {
    api.contribute.tools.add((draft) => draft.wrap("bash", (bash) => ({ ...bash, parameters })));
  },
} satisfies Plugin;
