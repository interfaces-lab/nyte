/**
 * Context-window overflow as a function of the failure class, plus the length
 * stop a caller may recover from.
 *
 * Based on https://github.com/earendil-works/pi/blob/dev/packages/ai/src/utils/overflow.ts
 * Synced with pi 7ebf9087e.
 */
import type { AssistantMessage } from "@nyte-ai/schema";
import { classifyAssistantFailure } from "./failure.ts";

/**
 * Whether an assistant message overflowed the context window: a provider error
 * that says so, or, with `contextWindow`, a silent overflow the provider accepted
 * or truncated. The error text patterns live in `failure.ts`.
 */
export function isContextOverflow(message: AssistantMessage, contextWindow?: number): boolean {
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
export function isRecoverableLength(message: AssistantMessage, desiredMaxOutput: number): boolean {
  return (
    message.stopReason === "length" &&
    desiredMaxOutput > 0 &&
    message.usage.output < desiredMaxOutput
  );
}
