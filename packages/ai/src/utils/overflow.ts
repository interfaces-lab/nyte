import type { AssistantMessage } from "@nyte-ai/schema/model";
import { classifyAssistantFailure } from "./failure.ts";

export function overflowsContext(message: AssistantMessage, contextWindow?: number): boolean {
  return (
    classifyAssistantFailure(message, contextWindow === undefined ? undefined : { contextWindow })
      .class === "context_window"
  );
}

/**
 * Check whether a length stop ended below the caller or model's intended output limit.
 * Such responses may be caused by context pressure or provider-side truncation, so callers
 * can make one bounded compact-and-retry attempt. `desiredMaxOutput` must be the original
 * limit before any context-based clamping.
 */
export function stoppedShort(message: AssistantMessage, desiredMaxOutput: number): boolean {
  return (
    message.stopReason === "length" &&
    desiredMaxOutput > 0 &&
    message.usage.output < desiredMaxOutput
  );
}
