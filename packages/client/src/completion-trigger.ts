/** The inline composer token currently being completed. */
export type CompletionTriggerKind = "@" | "/";

export interface CompletionTrigger {
  readonly kind: CompletionTriggerKind;
  /** Full token span. Accepting a result replaces this range. */
  readonly start: number;
  readonly end: number;
  /** Text between the trigger and caret, used to filter results. */
  readonly query: string;
}

function isCompletionTriggerKind(character: string): character is CompletionTriggerKind {
  return character === "@" || character === "/";
}

/**
 * Find the @ or / token under the caret. Mid-word trigger characters are text,
 * while the replacement range extends through the token's complete tail.
 */
export function completionTrigger(
  value: string,
  cursor = value.length,
): CompletionTrigger | undefined {
  const caret = Math.max(0, Math.min(cursor, value.length));
  let start = caret;

  while (start > 0 && (value[start - 1] ?? "").trim() !== "") start -= 1;
  const kind = value[start];

  if (start === caret || kind === undefined || !isCompletionTriggerKind(kind)) return undefined;
  let end = caret;

  while (end < value.length && (value[end] ?? "").trim() !== "") end += 1;

  return { kind, start, end, query: value.slice(start + 1, caret) };
}
