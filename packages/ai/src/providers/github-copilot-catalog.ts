/** Account availability, separate from the hosted model catalog. */
import { Type } from "typebox";
import { Value } from "typebox/value";
import { GITHUB_COPILOT_DEFAULT_ORIGIN } from "../api/github-copilot-headers.ts";

const CatalogResponse = Type.Object({ data: Type.Array(Type.Unknown()) });

const CatalogModel = Type.Object({
  id: Type.String({ minLength: 1 }),
  model_picker_enabled: Type.Optional(Type.Boolean()),
  policy: Type.Optional(Type.Object({ state: Type.Optional(Type.String()) })),
  capabilities: Type.Optional(
    Type.Object({
      supports: Type.Optional(Type.Object({ tool_calls: Type.Optional(Type.Boolean()) })),
    }),
  ),
});

/** Parses Copilot's model list into the models the account may pick. Only Individual accounts fall back to explicit enabled policies when picker flags fail. */
export function parseGitHubCopilotCatalog(
  value: unknown,
  origin: string,
  knownModelIds: ReadonlySet<string>,
) {
  if (!Value.Check(CatalogResponse, value)) {
    throw new Error("GitHub Copilot catalog response is not a model list");
  }

  const models = value.data
    .filter((entry) => Value.Check(CatalogModel, entry))
    .filter(
      (model) =>
        model.capabilities?.supports?.tool_calls !== false && model.policy?.state !== "disabled",
    );

  const individualFallback =
    origin === GITHUB_COPILOT_DEFAULT_ORIGIN && !models.some((model) => model.model_picker_enabled);

  const visible = models.filter((model) => individualFallback || model.model_picker_enabled);

  return {
    availableModelIds: [
      ...new Set(
        visible
          .filter((model) =>
            individualFallback
              ? model.policy?.state === "enabled"
              : model.policy?.state !== "unconfigured",
          )
          .map((model) => model.id),
      ),
    ],
    needsApproval: visible.some(
      (model) => model.policy?.state === "unconfigured" && knownModelIds.has(model.id),
    ),
  };
}
