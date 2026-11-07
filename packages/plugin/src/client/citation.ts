export interface Citation {
  readonly path: string;
  readonly lines: { readonly start: number; readonly end: number } | null;
}

const LOCATION =
  /^(?<path>.+?)(?::(?<start>\d+)(?:-(?<end>\d+)|:\d+)?|#L(?<anchorStart>\d+)(?:-L(?<anchorEnd>\d+))?)$/u;

export function parseCitation(text: string): Citation {
  const trimmed = text.trim().replace(/^\.\//u, "");
  const located = LOCATION.exec(trimmed)?.groups;
  const path = located?.path ?? trimmed;
  const start = Number(located?.start ?? located?.anchorStart);

  if (!Number.isSafeInteger(start) || start < 1) return { path, lines: null };
  const end = Number(located?.end ?? located?.anchorEnd ?? start);

  return { path, lines: { start, end: Math.max(start, end) } };
}
