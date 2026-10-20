const UNICODE_FORGERY = /[\u2028\u2029\u202a-\u202e]/g;

// oxlint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f-\x9f]/g;

export function sanitizeLine(text: string): string {
  return text.replace(CONTROL_CHARACTERS, "").replace(UNICODE_FORGERY, "");
}
