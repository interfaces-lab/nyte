import type { ModelRef } from "@nyte-ai/sdk";

export function modelConfiguration<Thinking>(
  model: ModelRef,
  thinking: Thinking | undefined,
): { readonly model: ModelRef; readonly thinking?: Thinking } {
  return thinking === undefined ? { model } : { model, thinking };
}
