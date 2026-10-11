/** Separators and bidi overrides can forge report structure without being C0 controls. */
const UNICODE_FORGERY = /[\u2028\u2029\u202a-\u202e]/g;

/**
 * Every page-derived string that lands on one report line. Newlines and tabs go
 * too, so a crafted title or role cannot forge a line of its own.
 */
export function sanitizeLine(text: string): string {
  // Matching control characters is the point: page text must not forge a line.
  // oxlint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x1f\x7f-\x9f]/g, "").replace(UNICODE_FORGERY, "");
}
