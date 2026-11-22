const UNWRAPPED_LINE_LENGTH = 10_000;

export function opensUnwrapped(text: string): boolean {
  let start = 0;

  while (start <= text.length) {
    const end = text.indexOf("\n", start);
    const stop = end === -1 ? text.length : end;

    if (stop - start > UNWRAPPED_LINE_LENGTH) return true;

    if (end === -1) return false;
    start = end + 1;
  }

  return false;
}
