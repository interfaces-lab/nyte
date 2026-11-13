import { DESIGN_PICK_CHARS } from "../../shared/browser-page.ts";

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Outline extends Box {
  readonly radius: number;
}

export interface ElementFacts {
  readonly label: string;
  readonly selector: string;
  readonly text: string;
  readonly bounds: Box;
  readonly attributes: string;
  readonly html: string;
}

export interface LabelParts {
  readonly name: string;
  readonly detail: string;
}

export const DRAG_THRESHOLD = 5;

export const MIN_AREA = 12;

const CROP_PADDING = 48;

const CROP_MIN = 120;

const ATTRIBUTES = 6;

const ATTRIBUTE_CHARS = 80;

const FACT_CHARS = { label: 200, text: 160, attributes: 600, html: 600 } as const;

const PASSED_OVER = new Set([
  "svg",
  "path",
  "circle",
  "rect",
  "line",
  "polyline",
  "polygon",
  "g",
  "use",
  "defs",
  "clippath",
  "mask",
  "span",
  "em",
  "strong",
  "b",
  "i",
  "u",
  "small",
  "sub",
  "sup",
  "br",
  "wbr",
]);

const INTERACTIVE_TAGS = new Set(["a", "button", "input", "select", "textarea", "label"]);

const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "tab",
  "menuitem",
  "checkbox",
  "radio",
  "switch",
]);

export function meaningfulElement(hit: Element, root: Element): Element {
  let node: Element | null = hit;

  for (let step = 0; step < 5 && node !== null && node !== root; step++) {
    if (worthSelecting(node)) return node;
    node = node.parentElement;
  }

  return hit;
}

export function meaningfulAncestor(element: Element, root: Element): Element | undefined {
  for (let node = element.parentElement; node !== null; node = node.parentElement) {
    if (node === root) return undefined;

    if (worthSelecting(node)) return node;
  }

  return undefined;
}

export function labelParts(element: Element): LabelParts {
  const label = labelFor(element);
  const space = label.indexOf(" ");

  return space === -1
    ? { name: label, detail: "" }
    : { name: label.slice(0, space), detail: label.slice(space + 1) };
}

export function elementBox(element: Element, root: Element): Box {
  return pageBox(element.getBoundingClientRect(), root);
}

export function pageBox(rect: DOMRect, root: Element): Box {
  const origin = root.getBoundingClientRect();

  return {
    x: rect.left - origin.left,
    y: rect.top - origin.top,
    width: rect.width,
    height: rect.height,
  };
}

export function measureOutline(element: Element, root: Element): Outline {
  return {
    ...elementBox(element, root),
    radius: Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0,
  };
}

export function visibleOutlines(
  elements: readonly Element[],
  root: Element,
  view: Box,
  limit: number,
): readonly Outline[] {
  const outlines: Outline[] = [];

  for (const element of elements) {
    if (outlines.length === limit) break;
    const box = elementBox(element, root);

    if (box.width >= 1 && box.height >= 1 && overlaps(box, view)) {
      outlines.push(measureOutline(element, root));
    }
  }

  return outlines;
}

export function coveredOutlines(outlines: readonly Outline[], area: Box): readonly Outline[] {
  return outlines.filter(
    (outline) =>
      outline.x >= area.x &&
      outline.y >= area.y &&
      outline.x + outline.width <= area.x + area.width &&
      outline.y + outline.height <= area.y + area.height,
  );
}

export function boxBetween(from: Point, to: Point): Box {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}

export function clipBox(box: Box, bounds: Box): Box {
  const left = Math.max(box.x, bounds.x);
  const top = Math.max(box.y, bounds.y);
  const right = Math.min(box.x + box.width, bounds.x + bounds.width);
  const bottom = Math.min(box.y + box.height, bounds.y + bounds.height);

  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

export function elementCrop(box: Box): Box {
  const width = Math.max(CROP_MIN, box.width + CROP_PADDING * 2);
  const height = Math.max(CROP_MIN, box.height + CROP_PADDING * 2);

  return {
    x: box.x + box.width / 2 - width / 2,
    y: box.y + box.height / 2 - height / 2,
    width,
    height,
  };
}

export function describeElement(element: Element, root: Element): ElementFacts {
  const attributes = [...element.attributes]
    .filter((attribute) => attribute.name !== "style")
    .slice(0, ATTRIBUTES)
    .map((attribute) => `${attribute.name}="${clip(attribute.value, ATTRIBUTE_CHARS)}"`)
    .join(" ");

  return {
    label: clip(labelFor(element), FACT_CHARS.label),
    selector: selectorFor(element, root),
    text: clip(collapse(element.textContent ?? ""), FACT_CHARS.text),
    bounds: elementBox(element, root),
    attributes: clip(attributes, FACT_CHARS.attributes),
    html: clip(collapse(element.outerHTML), FACT_CHARS.html),
  };
}

export function excerptText(facts: ElementFacts): string {
  const bounds = facts.bounds;

  return [
    `label: ${facts.label}`,
    ...(facts.text === "" ? [] : [`text: ${facts.text}`]),
    `bounds: x=${String(Math.round(bounds.x))} y=${String(Math.round(bounds.y))} w=${String(Math.round(bounds.width))} h=${String(Math.round(bounds.height))}`,
    ...(facts.attributes === "" ? [] : [`attributes: ${facts.attributes}`]),
    `html: ${facts.html}`,
  ].join("\n");
}

export function overlaps(box: Box, view: Box): boolean {
  return (
    box.x < view.x + view.width &&
    box.x + box.width > view.x &&
    box.y < view.y + view.height &&
    box.y + box.height > view.y
  );
}

function labelFor(element: Element): string {
  if (element.id !== "") return `${element.localName} #${element.id}`;
  const first = element.classList.item(0);

  return first === null ? element.localName : `${element.localName} .${first}`;
}

function selectorFor(element: Element, root: Element): string {
  const parts: string[] = [];

  for (
    let node: Element | null = element;
    node !== null && node !== root;
    node = node.parentElement
  ) {
    parts.unshift(selectorStep(node));
    const selector = parts.join(" > ");

    if (selector.length > DESIGN_PICK_CHARS.selector) {
      parts.shift();
      break;
    }

    if (root.querySelectorAll(selector).length === 1) return selector;
  }

  return parts.join(" > ") || element.localName;
}

export function worthSelecting(element: Element): boolean {
  if (INTERACTIVE_TAGS.has(element.localName) || element.id !== "") return true;
  const role = element.getAttribute("role");

  if (role !== null && INTERACTIVE_ROLES.has(role)) return true;

  return !PASSED_OVER.has(element.localName);
}

function selectorStep(element: Element): string {
  if (element.id !== "") return `#${CSS.escape(element.id)}`;

  const named = [...element.classList]
    .slice(0, 2)
    .reduce((part, name) => `${part}.${CSS.escape(name)}`, element.localName);

  const parent = element.parentElement;

  if (parent === null) return named;
  const siblings = [...parent.children];

  if (siblings.filter((child) => child.matches(named)).length < 2) return named;
  const sameTag = siblings.filter((child) => child.localName === element.localName);

  return `${named}:nth-of-type(${String(sameTag.indexOf(element) + 1)})`;
}

function collapse(text: string): string {
  return text.replaceAll(/\s+/g, " ").trim();
}

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
