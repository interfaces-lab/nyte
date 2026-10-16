import { MODEL_THINKING_LEVELS } from "@nyte-ai/schema/model";
import { Type, type Static } from "typebox";
import type { ThinkingLevelMap } from "../src/types.ts";

/** A models.dev reasoning control: an on/off toggle, named effort values, or a token budget range. */
export const ModelsDevReasoningOptionSchema = Type.Union([
  Type.Object({ type: Type.Literal("toggle") }),
  Type.Object({
    type: Type.Literal("effort"),
    values: Type.Array(Type.Union([Type.String(), Type.Null()])),
  }),
  Type.Object({
    type: Type.Literal("budget_tokens"),
    min: Type.Optional(Type.Number()),
    max: Type.Optional(Type.Number()),
  }),
]);

export type ModelsDevReasoningOption = Static<typeof ModelsDevReasoningOptionSchema>;

/**
 * Converts models.dev verified effort values into selectable thinking levels.
 * Values without an equivalent (`default` and JSON `null`) are intentionally
 * omitted.
 */
export function getEffortThinkingLevelMap(
  options: readonly ModelsDevReasoningOption[],
): ThinkingLevelMap | undefined {
  const effortValues = options.flatMap((option) => (option.type === "effort" ? option.values : []));

  if (effortValues.length === 0) return undefined;

  const supported = new Set(effortValues);

  if (
    !MODEL_THINKING_LEVELS.some((level) => level !== "off" && supported.has(level)) &&
    !supported.has("none")
  ) {
    return undefined;
  }

  const map: ThinkingLevelMap = { off: supported.has("none") ? "none" : null };

  for (const level of MODEL_THINKING_LEVELS) {
    if (level === "off") continue;
    map[level] = supported.has(level) ? level : null;
  }

  return map;
}
