/**
 * The in-page half of Design Mode, free of React so it could move into the page preload as is.
 * Every box here is in page content coordinates: CSS pixels from the page's top-left corner,
 * unaffected by scrolling or by the device frame's zoom.
 */

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * An element a comment holds: the node while it lasts, and its facts from when it was picked.
 * The facts' selector finds it again once a reload has replaced the node.
 */
export interface Anchor {
  readonly element: Element;
  readonly facts: ElementFacts;
}

export type Target =
  | { readonly kind: "element"; readonly anchors: readonly Anchor[] }
  | { readonly kind: "region"; readonly rect: Box; readonly anchor: Anchor };

/** A press that travels this far becomes a drag. */
export const DRAG_THRESHOLD = 5;

/** A drawn area smaller than this on either side is dropped, not turned into a click. */
export const MIN_AREA = 12;

const CROP_PADDING = 48;

const CROP_MIN = 120;

const TEXT_CHARS = 160;

const HTML_CHARS = 600;

const ATTRIBUTES = 6;

const ATTRIBUTE_CHARS = 80;

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

/** The element a pointer hit stands for: up to five steps past SVG parts and inline text tags. */
export function meaningfulElement(hit: Element, root: Element): Element {
  let node: Element | null = hit;

  for (let step = 0; step < 5 && node !== null && node !== root; step++) {
    if (worthSelecting(node)) return node;
    node = node.parentElement;
  }

  return hit;
}

/** The closest ancestor worth selecting, or `undefined` once the walk reaches the page itself. */
export function meaningfulAncestor(element: Element, root: Element): Element | undefined {
  for (let node = element.parentElement; node !== null; node = node.parentElement) {
    if (node === root) return undefined;

    if (worthSelecting(node)) return node;
  }

  return undefined;
}

/** `tag #id`, else `tag .firstClass`, else the tag. */
export function labelFor(element: Element): string {
  if (element.id !== "") return `${element.localName} #${element.id}`;
  const first = element.classList.item(0);

  return first === null ? element.localName : `${element.localName} .${first}`;
}

/** The shortest chain of steps from the page down that matches only `element`. */
export function selectorFor(element: Element, root: Element): string {
  const parts: string[] = [];

  for (
    let node: Element | null = element;
    node !== null && node !== root;
    node = node.parentElement
  ) {
    parts.unshift(selectorStep(node));
    const selector = parts.join(" > ");

    if (root.querySelectorAll(selector).length === 1) return selector;
  }

  return parts.join(" > ") || element.localName;
}

/** Where `element` sits in the page, whatever the scroll position and frame zoom. */
export function contentBox(element: Element, root: Element): Box {
  const rect = element.getBoundingClientRect();
  const origin = root.getBoundingClientRect();
  const unzoom = origin.width === 0 ? 1 : root.clientWidth / origin.width;

  return {
    x: (rect.left - origin.left) * unzoom,
    y: (rect.top - origin.top) * unzoom,
    width: rect.width * unzoom,
    height: rect.height * unzoom,
  };
}

/** A box with the element's own corner radius, so a highlight hugs a rounded element. */
export interface Outline extends Box {
  readonly radius: number;
}

export function measureOutline(element: Element, root: Element): Outline {
  return {
    ...contentBox(element, root),
    radius: Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0,
  };
}

/** X-ray: every element with a size that shows in `view`, capped so a huge page stays cheap. */
export function visibleOutlines(root: Element, view: Box, limit: number): readonly Outline[] {
  return [...root.querySelectorAll("*")]
    .flatMap((element) => {
      const outline = measureOutline(element, root);

      const shows =
        outline.width >= 1 &&
        outline.height >= 1 &&
        outline.x < view.x + view.width &&
        outline.x + outline.width > view.x &&
        outline.y < view.y + view.height &&
        outline.y + outline.height > view.y;

      return shows ? [outline] : [];
    })
    .slice(0, limit);
}

/** The selectable elements a drawn area wholly covers. */
export function coveredOutlines(root: Element, area: Box): readonly Outline[] {
  return [...root.querySelectorAll("*")].flatMap((element) => {
    if (!worthSelecting(element)) return [];
    const outline = measureOutline(element, root);

    const inside =
      outline.width >= 1 &&
      outline.height >= 1 &&
      outline.x >= area.x &&
      outline.y >= area.y &&
      outline.x + outline.width <= area.x + area.width &&
      outline.y + outline.height <= area.y + area.height;

    return inside ? [outline] : [];
  });
}

/** The label as two parts: the tag, read first, and the `#id` or `.class` that names it. */
export interface LabelParts {
  readonly name: string;
  readonly detail: string;
}

export function splitLabel(label: string): LabelParts {
  const space = label.indexOf(" ");

  return space === -1
    ? { name: label, detail: "" }
    : { name: label.slice(0, space), detail: label.slice(space + 1) };
}

export function labelParts(target: Target): LabelParts {
  if (target.kind === "region") {
    return {
      name: "Area",
      detail: `${String(Math.round(target.rect.width))} × ${String(Math.round(target.rect.height))}`,
    };
  }

  const first = target.anchors[0];

  if (target.anchors.length > 1 || first === undefined) {
    return { name: `${String(target.anchors.length)} elements`, detail: "" };
  }

  return splitLabel(first.facts.label);
}

export function anchorFor(element: Element, root: Element): Anchor {
  return { element, facts: describeElement(element, root) };
}

/**
 * Where an anchor's element is now: the same node if it survived, else whatever its selector
 * finds, as long as that still reads as the same tag and class. A selector that now lands on
 * a different kind of element counts as gone rather than as a match.
 */
export function findAnchor(anchor: Anchor, root: Element): Element | undefined {
  if (anchor.element.isConnected && root.contains(anchor.element)) return anchor.element;
  const found = root.querySelector(anchor.facts.selector);

  return found !== null && labelFor(found) === anchor.facts.label ? found : undefined;
}

/** The live elements an element target holds, or `undefined` once none of them is on the page. */
export function findElements(target: Target, root: Element): readonly Element[] | undefined {
  if (target.kind === "region") return [findAnchor(target.anchor, root) ?? root];
  const found = target.anchors.flatMap((anchor) => findAnchor(anchor, root) ?? []);

  return found.length === 0 ? undefined : found;
}

export function unionBox(boxes: readonly Box[]): Box {
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));

  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function boxBetween(
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
): Box {
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

/** The screenshot a comment attaches: an area as drawn, elements padded and grown to a readable size. */
function cropFor(target: CommentTarget, root: Element): Box {
  const page = { x: 0, y: 0, width: root.clientWidth, height: root.scrollHeight };

  if (target.kind === "region") return clipBox(target.rect, page);
  const union = unionBox(target.elements.map((facts) => facts.bounds));
  const width = Math.max(CROP_MIN, union.width + CROP_PADDING * 2);
  const height = Math.max(CROP_MIN, union.height + CROP_PADDING * 2);

  return clipBox(
    {
      x: union.x + union.width / 2 - width / 2,
      y: union.y + union.height / 2 - height / 2,
      width,
      height,
    },
    page,
  );
}

export interface ElementFacts {
  readonly label: string;
  readonly selector: string;
  readonly text: string;
  readonly bounds: Box;
  readonly attributes: string;
  readonly html: string;
}

export function describeElement(element: Element, root: Element): ElementFacts {
  const attributes = [...element.attributes]
    .filter((attribute) => attribute.name !== "style")
    .slice(0, ATTRIBUTES)
    .map((attribute) => `${attribute.name}="${clip(attribute.value, ATTRIBUTE_CHARS)}"`)
    .join(" ");

  return {
    label: labelFor(element),
    selector: selectorFor(element, root),
    text: clip(collapse(element.textContent ?? ""), TEXT_CHARS),
    bounds: contentBox(element, root),
    attributes,
    html: clip(collapse(element.outerHTML), HTML_CHARS),
  };
}

/** An anchor's facts as sent: fresh from the page when it was found, else as they were picked. */
export interface AnchorRecord extends ElementFacts {
  readonly found: boolean;
}

export type CommentTarget =
  | { readonly kind: "element"; readonly elements: readonly AnchorRecord[] }
  | { readonly kind: "region"; readonly rect: Box; readonly anchor: AnchorRecord };

/** A comment as it leaves the page: plain facts, no live elements. */
export interface CommentRecord {
  readonly number: number;
  readonly url: string;
  readonly comment: string;
  readonly target: CommentTarget;
  readonly crop: Box;
}

export function recordComment(
  input: {
    readonly number: number;
    readonly url: string;
    readonly comment: string;
    readonly target: Target;
  },
  root: Element,
): CommentRecord {
  const target: CommentTarget =
    input.target.kind === "element"
      ? {
          kind: "element",
          elements: input.target.anchors.map((anchor) => recordAnchor(anchor, root)),
        }
      : {
          kind: "region",
          rect: input.target.rect,
          anchor: recordAnchor(input.target.anchor, root),
        };

  return {
    number: input.number,
    url: input.url,
    comment: input.comment,
    crop: cropFor(target, root),
    target,
  };
}

function recordAnchor(anchor: Anchor, root: Element): AnchorRecord {
  const found = findAnchor(anchor, root);

  return found === undefined
    ? { ...anchor.facts, found: false }
    : { ...describeElement(found, root), found: true };
}

/**
 * What the agent would read, in the transcript's `<excerpt>` outline. A region names the
 * element at its centre as its anchor; the screenshot carries the rest.
 */
export function agentText(comments: readonly CommentRecord[], message: string): string {
  const blocks = comments.map((entry) => {
    const heading = comments.length > 1 ? [`Comment ${String(entry.number)}`] : [];

    const excerpts =
      entry.target.kind === "element"
        ? entry.target.elements.map((facts) =>
            excerpt(`url="${escape(entry.url)}" selector="${escape(facts.selector)}"`, facts),
          )
        : [
            excerpt(
              `url="${escape(entry.url)}" region="${formatBox(entry.target.rect)}" anchor="${escape(entry.target.anchor.selector)}"`,
              entry.target.anchor,
            ),
          ];

    const said = entry.comment === "" ? [] : [entry.comment];
    const image = `[image comment-${String(entry.number)}.png, ${String(Math.round(entry.crop.width))} × ${String(Math.round(entry.crop.height))} CSS px]`;

    return [...heading, ...excerpts, ...said, image].join("\n");
  });

  return [...blocks, ...(message === "" ? [] : [message])].join("\n\n");
}

export function formatBox(box: Box): string {
  return `x=${String(Math.round(box.x))} y=${String(Math.round(box.y))} w=${String(Math.round(box.width))} h=${String(Math.round(box.height))}`;
}

export function targetLabel(target: Target): string {
  if (target.kind === "region") {
    return `Area ${String(Math.round(target.rect.width))} × ${String(Math.round(target.rect.height))}`;
  }

  const first = target.anchors[0];

  if (first === undefined) return "Element";
  const more = target.anchors.length - 1;

  return more > 0 ? `${first.facts.label} +${String(more)}` : first.facts.label;
}

function excerpt(attributes: string, facts: AnchorRecord): string {
  return [
    `<excerpt source="browser" ${attributes}>`,
    ...(facts.found
      ? []
      : ["status: not on the page now; these facts are from when the comment was written"]),
    `label: ${facts.label}`,
    ...(facts.text === "" ? [] : [`text: ${facts.text}`]),
    `bounds: ${formatBox(facts.bounds)}`,
    ...(facts.attributes === "" ? [] : [`attributes: ${facts.attributes}`]),
    `html: ${facts.html}`,
    "</excerpt>",
  ].join("\n");
}

function worthSelecting(element: Element): boolean {
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

function escape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}
