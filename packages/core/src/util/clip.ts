/** The most characters of text one tool result or report puts in a model's context, its cut marker included. */
export const CLIP_CHARS = 32_000;

/** The most characters of one tool result that a conversation retold as text to another model keeps. */
const EXCERPT_CHARS = 2_000;

type Keep = "head" | "tail" | "ends";

/**
 * `text` cut to `CLIP_CHARS`, keeping its head, its tail, or both ends, around a
 * marker that counts the characters cut. `hint` ends the marker and tells the
 * model where the rest is. `cut` counts characters the caller already dropped
 * on the kept side's far end, so the marker shows them even when `text` fits.
 */
export function clipText(
  text: string,
  keep: Keep,
  options: { readonly hint?: string; readonly cut?: number } = {},
): string {
  return clip(text, keep, CLIP_CHARS, options.hint, options.cut ?? 0);
}

/** A tool result's start and end within `EXCERPT_CHARS`, for a conversation retold as text. */
export function excerptText(text: string): string {
  return clip(text, "ends", EXCERPT_CHARS, undefined, 0);
}

function clip(
  text: string,
  keep: Keep,
  limit: number,
  hint: string | undefined,
  cut: number,
): string {
  if (text.length <= limit && cut === 0) return text;
  const where = keep === "ends" ? " from the middle" : "";

  const marker = (count: number): string =>
    `[… ${count.toLocaleString("en-US")} characters cut${where}${hint === undefined ? "" : `; ${hint}`}]`;

  const room = limit - marker(cut + text.length).length - (keep === "ends" ? 4 : 2);
  const kept = Math.min(text.length, Math.max(0, room));
  const label = marker(cut + text.length - kept);

  if (keep === "head") return `${text.slice(0, kept)}\n\n${label}`;

  if (keep === "tail") return `${label}\n\n${text.slice(text.length - kept)}`;
  const head = Math.floor(kept / 4);

  return `${text.slice(0, head)}\n\n${label}\n\n${text.slice(text.length - kept + head)}`;
}
