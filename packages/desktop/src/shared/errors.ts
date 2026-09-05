/** The message a thrown value carries; anything that is not an Error reads as its string form. */
export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
