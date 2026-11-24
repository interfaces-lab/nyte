import type jsxRuntime from "react/jsx-runtime";
import { CANVAS_LAYOUT_GLOBAL, locateCanvasStack } from "@nyte-ai/plugin/canvas/protocol";
import type { CanvasLayoutFinding } from "@nyte-ai/plugin/core/canvas-preview";
import { KIT_ROLES, LAYOUT_FLOOR, findKitName } from "../kit/floor.ts";
import type { FloorRule } from "../kit/floor.ts";

type Runtime = typeof jsxRuntime;

interface Owner {
  readonly component: string;
  readonly at: string | null;
}

interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

interface Glyphs {
  readonly node: Text;
  readonly owner: Owner;
  readonly laid: readonly Box[];
  readonly boxes: readonly Box[];
  readonly surface: Element | null;
}

interface Draft {
  readonly rule: FloorRule;
  readonly key: string;
  readonly owner: Owner;
  readonly measured: number;
  readonly floor: number;
  readonly what: string;
}

const TOLERANCE = 0.5;

const FINDINGS_KEPT = 24;

const RULE_ORDER: readonly FloorRule[] = ["overflow", "overlap", "clip", "gap", "lead", "inset"];

const traces = new WeakMap<object, Error>();

const armed = { on: false };

export function installLayoutCheck(runtime: Runtime, readCode: () => string): Runtime {
  Object.defineProperty(globalThis, CANVAS_LAYOUT_GLOBAL, {
    value: {
      arm: () => {
        armed.on = true;
      },
      check: () => checkLayout(readCode()),
    },
    writable: false,
    configurable: false,
  });

  return {
    ...runtime,
    jsx: (type, props, key) => trace(runtime.jsx(type, props, key)),
    jsxs: (type, props, key) => trace(runtime.jsxs(type, props, key)),
  };
}

function trace<Made extends { readonly props: unknown }>(element: Made): Made {
  if (armed.on && typeof element.props === "object" && element.props !== null) {
    traces.set(element.props, new Error("canvas element"));
  }

  return element;
}

function checkLayout(code: string): CanvasLayoutFinding[] {
  const root = document.getElementById("root") ?? document.body;

  const unit = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue("--nyte-space-unit"),
  );

  const px = (steps: number): number => steps * (Number.isFinite(unit) ? unit : 4);
  const fibers = new FiberReader(root, code);

  const elements = [...root.querySelectorAll("*")].filter(
    (element) => !element.closest("[hidden]") && visible(element.getBoundingClientRect()),
  );

  const surfaces = elements.filter((element) => fibers.surface(element));
  const surfaceSet = new Set(surfaces);

  const findSurfaceAround = (element: Element): Element | null => {
    const parent = element.parentElement;

    if (parent === null || parent === root) return null;

    return surfaceSet.has(parent) ? parent : findSurfaceAround(parent);
  };

  const texts = readGlyphs(root, fibers, findSurfaceAround);
  const blocks = elements.filter((element) => fibers.textBlock(element));

  const drafts = [
    ...checkOverflow(root, elements, texts, fibers),
    ...checkTextOverlap(texts, surfaces),
    ...checkClip(root, texts),
    ...checkSurfaces(surfaces, findSurfaceAround, fibers, px(LAYOUT_FLOOR.gap.steps)),
    ...checkLead(surfaces, blocks, findSurfaceAround, fibers, px(LAYOUT_FLOOR.lead.steps)),
    ...checkInset(texts, surfaces, findSurfaceAround, fibers, px(LAYOUT_FLOOR.inset.steps)),
  ];

  const worst = new Map<string, Draft>();

  for (const draft of drafts) {
    const seen = worst.get(`${draft.rule} ${draft.key}`);

    if (seen === undefined || severity(draft) > severity(seen)) {
      worst.set(`${draft.rule} ${draft.key}`, draft);
    }
  }

  return [...worst.values()]
    .toSorted(
      (left, right) =>
        RULE_ORDER.indexOf(left.rule) - RULE_ORDER.indexOf(right.rule) ||
        severity(right) - severity(left),
    )
    .slice(0, FINDINGS_KEPT)
    .map((draft) => ({
      rule: draft.rule,
      component: draft.owner.component,
      at: draft.owner.at,
      measured: Math.round(draft.measured),
      floor: Math.round(draft.floor),
      message: draft.what,
      fix: LAYOUT_FLOOR[draft.rule].fix,
    }));
}

function severity(draft: Draft): number {
  return Math.abs(draft.floor - draft.measured);
}

function checkOverflow(
  root: Element,
  elements: readonly Element[],
  texts: readonly Glyphs[],
  fibers: FiberReader,
): Draft[] {
  const frame = root.getBoundingClientRect();
  const limit = frame.left + root.clientWidth;
  const past = (box: Box): number => Math.max(box.right - limit, frame.left - box.left);

  const scrolled = (element: Element): boolean => {
    const parent = element.parentElement;

    if (parent === null || parent === root) return false;
    const overflow = getComputedStyle(parent).overflowX;

    return (
      overflow === "auto" || overflow === "scroll" || overflow === "hidden" || scrolled(parent)
    );
  };

  const width = Math.round(root.clientWidth);

  const boxes = [
    ...elements
      .filter((element) => !(element.parentElement instanceof SVGElement))
      .map((element) => ({
        element,
        owner: fibers.owner(element),
        box: element.getBoundingClientRect(),
        parent: element.parentElement,
      })),
    ...texts.flatMap((text) =>
      text.boxes.map((box) => ({
        element: text.node.parentElement ?? root,
        owner: text.owner,
        box,
        parent: text.node.parentElement,
      })),
    ),
  ];

  return boxes
    .filter(
      (entry) =>
        past(entry.box) > TOLERANCE &&
        (entry.parent === null ||
          entry.parent === root ||
          past(entry.parent.getBoundingClientRect()) <= TOLERANCE) &&
        !scrolled(entry.element),
    )
    .map((entry) => ({
      rule: "overflow",
      key: describeOwner(entry.owner),
      owner: entry.owner,
      measured: -past(entry.box),
      floor: 0,
      what: `${describeOwner(entry.owner)} runs ${round(past(entry.box))} px past the ${width} px wide canvas`,
    }));
}

function checkTextOverlap(texts: readonly Glyphs[], surfaces: readonly Element[]): Draft[] {
  const kept = texts.slice(0, 600);

  const pairs = kept.flatMap((text, index) =>
    kept.slice(index + 1).flatMap((other) => {
      const area = text.boxes
        .flatMap((box) => other.boxes.map((next) => intersect(box, next)))
        .filter((overlap) => overlap.width > 1 && overlap.height > 1)
        .toSorted((left, right) => right.width * right.height - left.width * left.height)[0];

      if (area === undefined) return [];

      return [
        {
          rule: "overlap" as const,
          key: `${describeOwner(text.owner)} ${describeOwner(other.owner)}`,
          owner: text.owner,
          measured: -Math.min(area.width, area.height),
          floor: 0,
          what: `${quote(text.node)} in ${describeOwner(text.owner)} overlaps ${quote(other.node)} in ${describeOwner(other.owner)} by ${round(area.width)} × ${round(area.height)} px`,
        },
      ];
    }),
  );

  const intrusions = kept.flatMap((text) =>
    surfaces
      .filter((surface) => !surface.contains(text.node))
      .flatMap((surface) => {
        const frame = surface.getBoundingClientRect();

        const area = text.boxes
          .map((box) => intersect(box, frame))
          .find((overlap) => overlap.width > 1 && overlap.height > 1);

        if (area === undefined) return [];

        return [
          {
            rule: "overlap" as const,
            key: `${describeOwner(text.owner)} ${surface.tagName}${String(Math.round(frame.top))}`,
            owner: text.owner,
            measured: -area.width,
            floor: 0,
            what: `${quote(text.node)} in ${describeOwner(text.owner)} runs ${round(area.width)} px into a surface it isn't in`,
          },
        ];
      }),
  );

  return [...pairs, ...intrusions];
}

function checkClip(root: Element, texts: readonly Glyphs[]): Draft[] {
  return texts.flatMap((text) => {
    const clipper = findClipper(root, text.node.parentElement);

    if (clipper === undefined) return [];
    const frame = clipper.box;

    const sides = text.laid.flatMap((box) => [
      { side: "left", by: frame.left - box.left },
      { side: "right", by: box.right - frame.right },
      { side: "top", by: frame.top - box.top },
      { side: "bottom", by: box.bottom - frame.bottom },
    ]);

    const worst = sides.toSorted((left, right) => right.by - left.by)[0];

    if (worst === undefined || worst.by <= TOLERANCE) return [];

    return [
      {
        rule: "clip",
        key: `${describeOwner(text.owner)} ${clipper.name}`,
        owner: text.owner,
        measured: -worst.by,
        floor: 0,
        what: `${quote(text.node)} in ${describeOwner(text.owner)} is cut off by ${round(worst.by)} px at the ${worst.side} by ${clipper.name}`,
      },
    ];
  });
}

function findClipper(
  root: Element,
  element: Element | null,
): { readonly box: Box; readonly name: string } | undefined {
  if (element === null || element === root) return undefined;
  const style = getComputedStyle(element);
  const box = element.getBoundingClientRect();
  const small = box.width <= 2 || box.height <= 2;
  const truncates =
    style.textOverflow === "ellipsis" || style.getPropertyValue("-webkit-line-clamp") !== "none";
  const hides = (overflow: string): boolean => overflow === "hidden" || overflow === "clip";
  const scrolls = (overflow: string): boolean => overflow === "auto" || overflow === "scroll";

  if (small || truncates || scrolls(style.overflowX) || scrolls(style.overflowY)) return undefined;

  if (hides(style.overflowX) || hides(style.overflowY)) {
    return {
      box: element instanceof SVGSVGElement ? box : clientBox(element),
      name:
        element instanceof SVGSVGElement
          ? "the chart's own box"
          : `its <${element.tagName.toLowerCase()}>`,
    };
  }

  return findClipper(root, element.parentElement);
}

function checkSurfaces(
  surfaces: readonly Element[],
  findSurfaceAround: (element: Element) => Element | null,
  fibers: FiberReader,
  floor: number,
): Draft[] {
  return surfaces.flatMap((surface, index) =>
    surfaces.slice(index + 1).flatMap((other): Draft[] => {
      if (surface.contains(other) || other.contains(surface)) return [];

      if (findSurfaceAround(surface) !== findSurfaceAround(other)) return [];
      const one = surface.getBoundingClientRect();
      const two = other.getBoundingClientRect();
      const across = Math.max(two.left - one.right, one.left - two.right);
      const down = Math.max(two.top - one.bottom, one.top - two.bottom);
      const first = fibers.owner(surface);
      const second = fibers.owner(other);
      const pair = `${describeOwner(first)} and ${describeOwner(second)}`;

      if (across < -TOLERANCE && down < -TOLERANCE) {
        return [
          {
            rule: "overlap",
            key: pair,
            owner: second,
            measured: Math.max(across, down),
            floor: 0,
            what: `${pair} overlap by ${round(-Math.max(across, down))} px`,
          },
        ];
      }
      const apart = across < 0 ? down : down < 0 ? across : Number.POSITIVE_INFINITY;

      if (apart >= floor - TOLERANCE) return [];

      return [
        {
          rule: "gap",
          key: pair,
          owner: second,
          measured: apart,
          floor,
          what: `${pair} are ${round(apart)} px apart; surfaces need ${round(floor)} px between them`,
        },
      ];
    }),
  );
}

function checkLead(
  surfaces: readonly Element[],
  blocks: readonly Element[],
  findSurfaceAround: (element: Element) => Element | null,
  fibers: FiberReader,
  floor: number,
): Draft[] {
  return surfaces.flatMap((surface): Draft[] => {
    const frame = surface.getBoundingClientRect();

    const above = [...surfaces, ...blocks]
      .filter(
        (candidate) =>
          candidate !== surface &&
          !candidate.contains(surface) &&
          !surface.contains(candidate) &&
          findSurfaceAround(candidate) === findSurfaceAround(surface),
      )
      .map((candidate) => ({ candidate, box: candidate.getBoundingClientRect() }))
      .filter(
        (entry) =>
          entry.box.bottom <= frame.top + TOLERANCE &&
          Math.min(entry.box.right, frame.right) - Math.max(entry.box.left, frame.left) > 0,
      )
      .toSorted((left, right) => right.box.bottom - left.box.bottom)[0];

    if (above === undefined || !blocks.includes(above.candidate)) return [];
    const apart = frame.top - above.box.bottom;

    if (apart >= floor - TOLERANCE) return [];
    const owner = fibers.owner(surface);
    const heading = fibers.owner(above.candidate);

    return [
      {
        rule: "lead",
        key: describeOwner(heading),
        owner,
        measured: apart,
        floor,
        what: `${describeOwner(owner)} starts ${round(apart)} px below ${describeOwner(heading)}, which introduces it; a heading needs ${round(floor)} px before its block`,
      },
    ];
  });
}

function checkInset(
  texts: readonly Glyphs[],
  surfaces: readonly Element[],
  findSurfaceAround: (element: Element) => Element | null,
  fibers: FiberReader,
  floor: number,
): Draft[] {
  const glyphs = texts.flatMap((text): Draft[] => {
    if (text.surface === null) return [];
    const near = nearestEdge(text.boxes, clientBox(text.surface));

    if (near === undefined || near.by >= floor - TOLERANCE) return [];
    const holder = fibers.owner(text.surface);

    if (near.by < -TOLERANCE) {
      return [
        {
          rule: "overflow",
          key: `${describeOwner(text.owner)} ${describeOwner(holder)}`,
          owner: text.owner,
          measured: near.by,
          floor: 0,
          what: `${quote(text.node)} in ${describeOwner(text.owner)} runs ${round(-near.by)} px past the ${near.side} edge of its ${describeOwner(holder)}`,
        },
      ];
    }

    return [
      {
        rule: "inset",
        key: `${describeOwner(text.owner)} ${describeOwner(holder)}`,
        owner: text.owner,
        measured: near.by,
        floor,
        what: `${quote(text.node)} in ${describeOwner(text.owner)} is ${round(Math.max(0, near.by))} px from the ${near.side} edge of its ${describeOwner(holder)}; text needs ${round(floor)} px`,
      },
    ];
  });

  const nested = surfaces.flatMap((surface): Draft[] => {
    const holder = findSurfaceAround(surface);

    if (holder === null) return [];
    const near = nearestEdge([surface.getBoundingClientRect()], clientBox(holder));

    if (near === undefined || near.by >= floor - TOLERANCE) return [];
    const owner = fibers.owner(surface);

    return [
      {
        rule: "inset",
        key: `${describeOwner(owner)} ${describeOwner(fibers.owner(holder))}`,
        owner,
        measured: near.by,
        floor,
        what: `${describeOwner(owner)} is ${round(near.by)} px from the ${near.side} edge of the ${describeOwner(fibers.owner(holder))} around it; it needs ${round(floor)} px`,
      },
    ];
  });

  return [...glyphs, ...nested];
}

function nearestEdge(
  boxes: readonly Box[],
  frame: Box,
): { readonly side: string; readonly by: number } | undefined {
  return boxes
    .flatMap((box) => [
      { side: "left", by: box.left - frame.left },
      { side: "right", by: frame.right - box.right },
      { side: "top", by: box.top - frame.top },
      { side: "bottom", by: frame.bottom - box.bottom },
    ])
    .toSorted((left, right) => left.by - right.by)[0];
}

function readGlyphs(
  root: Element,
  fibers: FiberReader,
  findSurfaceAround: (element: Element) => Element | null,
): Glyphs[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];

  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node instanceof Text && node.data.trim() !== "") nodes.push(node);
  }

  return nodes.flatMap((node) => {
    const parent = node.parentElement;

    if (parent === null || parent.closest("[hidden], title, style, script") !== null) return [];
    const range = document.createRange();
    range.selectNodeContents(node);
    const laid = [...range.getClientRects()].filter(visible);
    const boxes = shown(root, parent, laid);

    if (boxes.length === 0) return [];

    return [
      {
        node,
        owner: fibers.owner(parent),
        laid,
        boxes,
        surface: fibers.surface(parent) ? parent : findSurfaceAround(parent),
      },
    ];
  });
}

function shown(root: Element, element: Element | null, boxes: readonly Box[]): readonly Box[] {
  if (element === null || element === root || boxes.length === 0) return boxes;
  const style = getComputedStyle(element);

  if (style.visibility === "hidden" || style.opacity === "0" || style.clip !== "auto") return [];
  const clips = [style.overflowX, style.overflowY].some((overflow) => overflow !== "visible");
  const frame = clips ? clientBox(element) : undefined;

  const kept =
    frame === undefined
      ? boxes
      : boxes
          .map((box) => ({
            left: Math.max(box.left, frame.left),
            top: Math.max(box.top, frame.top),
            right: Math.min(box.right, frame.right),
            bottom: Math.min(box.bottom, frame.bottom),
          }))
          .filter((box) => box.right - box.left > 1 && box.bottom - box.top > 1);

  return shown(root, element.parentElement, kept);
}

function clientBox(element: Element): Box {
  const box = element.getBoundingClientRect();
  const left = box.left + element.clientLeft;
  const top = box.top + element.clientTop;

  return {
    left,
    top,
    right: element.clientWidth > 0 ? left + element.clientWidth : box.right,
    bottom: element.clientHeight > 0 ? top + element.clientHeight : box.bottom,
  };
}

function intersect(one: Box, two: Box): { readonly width: number; readonly height: number } {
  return {
    width: Math.min(one.right, two.right) - Math.max(one.left, two.left),
    height: Math.min(one.bottom, two.bottom) - Math.max(one.top, two.top),
  };
}

function visible(box: Box): boolean {
  return box.right > box.left && box.bottom > box.top;
}

function round(value: number): string {
  return String(Math.round(value));
}

function quote(node: Text): string {
  const words = node.data.trim().replaceAll(/\s+/gu, " ");

  return `"${words.length > 32 ? `${words.slice(0, 31)}…` : words}"`;
}

function describeOwner(owner: Owner): string {
  return owner.at === null ? owner.component : `${owner.component} (${owner.at})`;
}

function painted(element: Element): boolean {
  const style = getComputedStyle(element);

  const clear = (color: string): boolean =>
    color === "transparent" || /rgba\([^)]*,\s*0\)$/u.test(color) || /\/\s*0\)$/u.test(color);

  return (
    !clear(style.backgroundColor) ||
    (Number.parseFloat(style.borderTopWidth) > 0 && !clear(style.borderTopColor)) ||
    style.boxShadow !== "none"
  );
}

class FiberReader {
  private readonly key: string | undefined;
  private readonly code: string;
  private readonly owners = new Map<Element, Owner>();

  constructor(root: Element, code: string) {
    const first = root.querySelector("*");
    this.key =
      first === null
        ? undefined
        : Object.keys(first).find((key) => key.startsWith("__reactFiber$"));
    this.code = code;
  }

  owner(element: Element): Owner {
    const known = this.owners.get(element);

    if (known !== undefined) return known;

    const found = this.walk(this.fiber(element), undefined) ?? {
      component: `<${element.tagName.toLowerCase()}>`,
      at: null,
    };

    this.owners.set(element, found);

    return found;
  }

  surface(element: Element): boolean {
    const display = getComputedStyle(element).display;

    if (display.startsWith("inline") || display === "contents") return false;
    const name = this.findKitRoot(element);

    if (name !== undefined) return KIT_ROLES.get(name) === "surface";
    const props = read(this.fiber(element), "memoizedProps");
    const box = element.getBoundingClientRect();

    return (
      typeof props === "object" &&
      props !== null &&
      traces.has(props) &&
      !(element instanceof SVGElement) &&
      box.width >= 16 &&
      box.height >= 16 &&
      painted(element)
    );
  }

  textBlock(element: Element): boolean {
    const name = this.findKitRoot(element);

    if (name !== undefined) return KIT_ROLES.get(name) === "text";
    const props = read(this.fiber(element), "memoizedProps");

    return (
      /^(?:H[1-6]|P)$/u.test(element.tagName) &&
      typeof props === "object" &&
      props !== null &&
      traces.has(props)
    );
  }

  private fiber(element: Element): unknown {
    return this.key === undefined
      ? undefined
      : Object.getOwnPropertyDescriptor(element, this.key)?.value;
  }

  private findKitRoot(element: Element): string | undefined {
    for (
      let fiber = read(this.fiber(element), "return");
      fiber !== undefined && fiber !== null;
      fiber = read(fiber, "return")
    ) {
      const type = read(fiber, "type");

      if (typeof type === "string") return undefined;
      const name = findKitName(type);

      if (name !== undefined) return name;
    }

    return undefined;
  }

  private walk(fiber: unknown, kit: string | undefined): Owner | undefined {
    if (fiber === undefined || fiber === null) {
      return kit === undefined ? undefined : { component: kit, at: null };
    }
    const type = read(fiber, "type");
    const props = read(fiber, "memoizedProps");
    const name = findKitName(type);
    const traced = typeof props === "object" && props !== null ? traces.get(props) : undefined;

    if (traced !== undefined) {
      return {
        component: name ?? nameType(type),
        at: locateCanvasStack(this.code, traced.stack ?? "") ?? null,
      };
    }

    return this.walk(read(fiber, "return"), kit ?? name);
  }
}

function read(value: unknown, field: string): unknown {
  return typeof value === "object" && value !== null
    ? Object.getOwnPropertyDescriptor(value, field)?.value
    : undefined;
}

function nameType(type: unknown): string {
  if (typeof type === "string") return `<${type}>`;

  if (typeof type === "function" && type.name !== "") return type.name;

  return "an element";
}
