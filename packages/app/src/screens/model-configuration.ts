import type { ModelRef } from "@nyte-ai/sdk";

/** A chat's model choice as the host takes it: the thinking level only when one is chosen. */
export function modelConfiguration<Thinking>(
  model: ModelRef,
  thinking: Thinking | undefined,
): { readonly model: ModelRef; readonly thinking?: Thinking } {
  return thinking === undefined ? { model } : { model, thinking };
}
