import { overlaps, pageBox } from "./picker.ts";
import type { Box } from "./picker.ts";

export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export interface Token {
  readonly name: string;
  readonly color: Rgba;
}

export interface TokenMatch {
  readonly name: string;
  readonly distance: number;
}

export interface Inspection {
  readonly font: string;
  readonly size: number;
  readonly lineHeight: string;
  readonly weight: string;
  readonly ink: Rgba;
  readonly paper: Rgba;
  readonly inkToken: TokenMatch | undefined;
  readonly paperToken: TokenMatch | undefined;
  readonly contrast: Contrast;
}

export interface Contrast {
  readonly ratio: number;
  readonly large: boolean;
  readonly level: "AAA" | "AA" | "fail";
}

export interface ContrastMark {
  readonly box: Box;
  readonly contrast: Contrast;
}

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };

const TEXT_LIMIT = 400;

export function inspectElement(
  element: Element,
  root: Element,
  tokens: readonly Token[],
): Inspection {
  const style = getComputedStyle(element);
  const ink = parseColor(style.color);
  const paper = backgroundBehind(element, root);
  const size = Number.parseFloat(style.fontSize) || 0;

  return {
    font: style.fontFamily.split(",")[0]?.replaceAll('"', "").trim() ?? "",
    size,
    lineHeight:
      style.lineHeight === "normal"
        ? "normal"
        : String(Math.round(Number.parseFloat(style.lineHeight))),
    weight: style.fontWeight,
    ink,
    paper,
    inkToken: nearestToken(ink, tokens),
    paperToken: nearestToken(paper, tokens),
    contrast: measureContrast(
      blend(ink, paper),
      paper,
      size,
      Number.parseInt(style.fontWeight, 10),
    ),
  };
}

export function contrastMarks(
  elements: readonly Element[],
  root: Element,
  view: Box,
): readonly ContrastMark[] {
  const marks: ContrastMark[] = [];

  for (const element of elements) {
    if (marks.length === TEXT_LIMIT) break;

    const ownsText = [...element.childNodes].some(
      (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "",
    );

    if (!ownsText || !overlaps(pageBox(element.getBoundingClientRect(), root), view)) continue;
    const box = textBox(element, root);

    if (box.width < 1 || box.height < 1 || !overlaps(box, view)) continue;
    const style = getComputedStyle(element);
    const paper = backgroundBehind(element, root);

    marks.push({
      box,
      contrast: measureContrast(
        blend(parseColor(style.color), paper),
        paper,
        Number.parseFloat(style.fontSize) || 0,
        Number.parseInt(style.fontWeight, 10),
      ),
    });
  }

  return marks;
}

function textBox(element: Element, root: Element): Box {
  const range = document.createRange();

  range.selectNodeContents(element);

  return pageBox(range.getBoundingClientRect(), root);
}

export function pageTokens(root: Element): readonly Token[] {
  const names = new Set(
    [...document.styleSheets].flatMap((sheet) => {
      const rules = readRules(sheet);

      return rules.flatMap((rule) =>
        rule instanceof CSSStyleRule && root.matches(rule.selectorText)
          ? [...rule.style].filter((name) => name.startsWith("--"))
          : [],
      );
    }),
  );

  const style = getComputedStyle(root);

  return [...names].flatMap((name) => {
    const value = style.getPropertyValue(name).trim();
    const color = CSS.supports("color", value) ? parseColor(value) : undefined;

    return color === undefined ? [] : [{ name, color }];
  });
}

function nearestToken(color: Rgba, tokens: readonly Token[]): TokenMatch | undefined {
  return tokens
    .map((token) => ({
      name: token.name,
      distance: Math.hypot(
        token.color.r - color.r,
        token.color.g - color.g,
        token.color.b - color.b,
      ),
    }))
    .toSorted((left, right) => left.distance - right.distance)[0];
}

export function formatHex(color: Rgba): string {
  const hex = [color.r, color.g, color.b]
    .map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
    .join("");

  return color.a < 1 ? `#${hex} ${String(Math.round(color.a * 100))}%` : `#${hex}`;
}

function measureContrast(ink: Rgba, paper: Rgba, size: number, weight: number): Contrast {
  const lighter = Math.max(luminance(ink), luminance(paper));
  const darker = Math.min(luminance(ink), luminance(paper));
  const ratio = (lighter + 0.05) / (darker + 0.05);
  const large = size >= 24 || (size >= 18.66 && weight >= 700);
  const aa = large ? 3 : 4.5;
  const aaa = large ? 4.5 : 7;

  return { ratio, large, level: ratio >= aaa ? "AAA" : ratio >= aa ? "AA" : "fail" };
}

function backgroundBehind(element: Element, root: Element): Rgba {
  const layers: Rgba[] = [];

  for (let node: Element | null = element; node !== null; node = node.parentElement) {
    const color = parseColor(getComputedStyle(node).backgroundColor);

    if (color.a > 0) layers.push(color);

    if (color.a >= 1 || node === root) break;
  }

  return layers.toReversed().reduce((behind, layer) => blend(layer, behind), WHITE);
}

function blend(top: Rgba, behind: Rgba): Rgba {
  return {
    r: top.r * top.a + behind.r * (1 - top.a),
    g: top.g * top.a + behind.g * (1 - top.a),
    b: top.b * top.a + behind.b * (1 - top.a),
    a: 1,
  };
}

function luminance(color: Rgba): number {
  const linear = (channel: number): number => {
    const value = channel / 255;

    return value <= 0.039_28 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

let probe: CanvasRenderingContext2D | undefined;

function parseColor(value: string): Rgba {
  probe ??=
    document.createElement("canvas").getContext("2d", { willReadFrequently: true }) ?? undefined;

  if (probe === undefined) return WHITE;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "transparent";
  probe.fillStyle = value;
  probe.fillRect(0, 0, 1, 1);
  const pixel = probe.getImageData(0, 0, 1, 1).data;

  return { r: pixel[0] ?? 0, g: pixel[1] ?? 0, b: pixel[2] ?? 0, a: (pixel[3] ?? 0) / 255 };
}

function readRules(sheet: CSSStyleSheet): readonly CSSRule[] {
  try {
    return [...sheet.cssRules];
  } catch {
    return [];
  }
}
