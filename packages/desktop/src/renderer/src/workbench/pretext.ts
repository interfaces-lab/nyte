/** Canvas measure once, then arithmetic. */
import { layout, measureNaturalWidth, prepare, prepareWithSegments } from "@chenglou/pretext";

const ELLIPSIS = "\u2026";
const PRE_WRAP = { whiteSpace: "pre-wrap" } as const;

export function canvasFont({
  fontFamily,
  fontSize,
  fontWeight,
  fontStyle,
  fontVariant,
}: {
  readonly fontFamily: string;
  readonly fontSize: string;
  readonly fontWeight?: string;
  readonly fontStyle?: string;
  readonly fontVariant?: string;
}): string {
  const style = fontStyle !== undefined && fontStyle !== "normal" ? `${fontStyle} ` : "";
  const variant = fontVariant !== undefined && fontVariant !== "normal" ? `${fontVariant} ` : "";
  const weight = fontWeight !== undefined && fontWeight !== "normal" ? `${fontWeight} ` : "";
  return `${style}${variant}${weight}${fontSize} ${fontFamily}`.trim();
}

/** Keep `keep` units and put the ellipsis in the middle. */
export function middleEllipsis(text: string, keep: number): string {
  if (keep >= text.length) return text;
  if (keep <= 0) return ELLIPSIS;
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return `${text.slice(0, head)}${ELLIPSIS}${text.slice(text.length - tail)}`;
}

/**
 * Binary-search a middle ellipsis so the label stays on one measured line.
 * `fits` is injected so tests do not need canvas.
 */
export function truncateMiddleText({
  text,
  maxWidth,
  fits,
}: {
  readonly text: string;
  readonly maxWidth: number;
  readonly fits: (value: string) => boolean;
}): string {
  if (text === "" || maxWidth <= 0 || !Number.isFinite(maxWidth)) return text;
  if (fits(text)) return text;
  if (!fits(ELLIPSIS)) return ELLIPSIS;
  let low = 0;
  let high = text.length;
  let best = ELLIPSIS;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = middleEllipsis(text, mid);
    if (fits(candidate)) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

/** Keep the tail so a long path still ends on the filename. */
export function truncateStartText({
  text,
  maxWidth,
  fits,
}: {
  readonly text: string;
  readonly maxWidth: number;
  readonly fits: (value: string) => boolean;
}): string {
  if (text === "" || maxWidth <= 0 || !Number.isFinite(maxWidth)) return text;
  if (fits(text)) return text;
  if (!fits(ELLIPSIS)) return ELLIPSIS;
  let low = 0;
  let high = text.length;
  let best = ELLIPSIS;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = mid === 0 ? ELLIPSIS : `${ELLIPSIS}${text.slice(text.length - mid)}`;
    if (fits(candidate)) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

export function pretextFitsWidth(text: string, font: string, maxWidth: number): boolean {
  return measureNaturalWidth(prepareWithSegments(text, font)) <= maxWidth;
}

export function pretextNaturalWidth(text: string, font: string): number {
  return measureNaturalWidth(prepareWithSegments(text, font));
}

export function pretextLineHeight(
  text: string,
  font: string,
  maxWidth: number,
  lineHeight: number,
): number {
  if (text === "") return lineHeight;
  return Math.max(lineHeight, layout(prepare(text, font, PRE_WRAP), maxWidth, lineHeight).height);
}
