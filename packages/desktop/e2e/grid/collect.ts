/**
 * The renderer side of the grid check. `collect` and `drawOverlay` run through `page.evaluate`, which
 * sends their source text, so neither may reference anything outside its own body.
 */
import type { BoxFact, Locate, RegionName } from "./rules.ts";

export interface PlannedRail {
  readonly name: string;
  readonly from: "start" | "end";
  readonly css: string;
}

export interface PlannedRegion {
  readonly name: RegionName;
  readonly locate: Locate;
  readonly rails: readonly PlannedRail[];
  readonly rows: string | null;
  readonly pitch: string | null;
  readonly centred: string | null;
}

export interface Plan {
  readonly regions: readonly PlannedRegion[];
  readonly exceptions: readonly { readonly name: string; readonly selector: string }[];
  readonly picks: readonly { readonly name: string; readonly selector: string }[];
  readonly ends: {
    readonly pane: string;
    readonly viewport: string;
    readonly row: string;
    readonly dock: string;
  };
}

/** A chat pane's transcript end: the view it has, and where the conversation's last line of text is. */
export interface PaneEnd {
  readonly pane: number;
  /** The transcript's content box, which the finding is reported on. */
  readonly content: number;
  readonly viewTop: number;
  /** The viewport's bottom, or the composer's top when it sits over the viewport. */
  readonly viewBottom: number;
  /** The last line of the last row that has text, wherever it is, on screen or not. */
  readonly lastLine: { readonly index: number; readonly rect: Rect; readonly row: Rect } | null;
}

interface Edges {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** Where a run's content box and baseline sit inside its line box, for one font and line height. */
interface LineMetrics {
  readonly content: number;
  readonly baseline: number;
  readonly lineHeight: number;
}

export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface Declaration {
  readonly property: string;
  readonly value: string;
  readonly selector: string;
}

export interface SnapBox {
  readonly id: number;
  readonly parent: number | null;
  readonly tag: string;
  readonly slot: string | null;
  readonly role: string | null;
  readonly name: string;
  readonly key: string;
  readonly rect: Rect;
  readonly visible: boolean;
  readonly region: number | null;
  readonly painted: boolean;
  readonly control: boolean;
  readonly iconOnly: boolean;
  readonly svg: boolean;
  /** An svg the Icon component drew, as opposed to a diagram or an illustration. */
  readonly icon: boolean;
  readonly flow: "row" | "column" | "grid" | "block" | "inline";
  readonly outOfFlow: boolean;
  /** Computed lengths in px, by longhand; keywords and percentages are left out. */
  readonly lengths: Readonly<Record<string, number>>;
  readonly font: {
    readonly size: number;
    readonly lineHeight: number | null;
    readonly mono: boolean;
    readonly inline: boolean;
  };
  readonly facts: readonly BoxFact[];
  readonly exceptions: readonly string[];
  readonly declarations: readonly Declaration[];
}

export interface SnapText {
  readonly box: number;
  /** Where text-align puts the run: centred and end-aligned runs start where their width puts them. */
  readonly align: "start" | "centred" | "end-aligned";
  readonly text: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly lineTop: number;
  readonly lineHeight: number;
  readonly baseline: number;
}

export interface SnapRegion {
  readonly name: RegionName;
  readonly index: number;
  readonly box: number;
  readonly rect: Rect;
  readonly rails: readonly {
    readonly name: string;
    readonly from: "start" | "end";
    readonly offset: number;
  }[];
  readonly pitch: number | null;
  readonly rows: readonly number[];
  readonly centred: readonly number[];
}

export interface Snapshot {
  readonly viewport: { readonly width: number; readonly height: number; readonly dpr: number };
  readonly fonts: { readonly ui: string; readonly mono: string; readonly uiLoaded: boolean };
  readonly regions: readonly SnapRegion[];
  readonly boxes: readonly SnapBox[];
  readonly texts: readonly SnapText[];
  readonly picks: readonly { readonly name: string; readonly box: number | null }[];
  readonly ends: readonly PaneEnd[];
}

/**
 * Reads every laid-out box and text run on the page, with the facts the checker needs.
 *
 * - Rules come from the CSSOM in cascade order: the base layer, StyleX's priority layers, then unlayered
 *   rules, so the last declaration of a property on a box is the one that won.
 * - A box's name is its accessible label or its first text run; later runs are metadata, such as a
 *   relative time, that changes between runs. Occurrence numbers count only visible boxes, so content
 *   scrolled out of view can't renumber what is on screen.
 * - A child whose start follows its own width, centred or pushed to the end of its parent's content
 *   box, says so in its facts.
 * - Rail and pitch lengths resolve on a probe inside the region, so overrides scoped to it apply. A
 *   run's line box comes from a probe of the same font, which gives where the content box and the
 *   baseline sit inside it. A placeholder is a pseudo-element, so its line is placed from the field.
 */
export function collect(plan: Plan): Snapshot {
  const round = (value: number): number => Math.round(value * 100) / 100;

  const LENGTHS = [
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
    "row-gap",
    "column-gap",
    "top",
    "right",
    "bottom",
    "left",
    "width",
    "height",
    "border-top-width",
    "border-right-width",
    "border-bottom-width",
    "border-left-width",
    "border-top-left-radius",
    "border-top-right-radius",
    "border-bottom-right-radius",
    "border-bottom-left-radius",
  ];

  const CONTROL_ROLES = new Set([
    "button",
    "tab",
    "menuitem",
    "menuitemradio",
    "menuitemcheckbox",
    "switch",
    "checkbox",
    "radio",
    "option",
    "combobox",
  ]);

  interface IndexedRule {
    readonly selector: string;
    readonly css: string;
    readonly rank: number;
  }

  const byClass = new Map<string, IndexedRule[]>();
  const unclassed: IndexedRule[] = [];
  let order = 0;

  const layerRank = (name: string | null): number => {
    if (name === null) return 1000;

    if (name === "base") return 0;
    const priority = /^priority(\d+)$/u.exec(name);

    return priority === null ? 500 : 1 + Number(priority[1]);
  };

  const applies = (rule: CSSRule): boolean => {
    if (rule instanceof CSSMediaRule) return matchMedia(rule.conditionText).matches;

    if (rule instanceof CSSSupportsRule) return CSS.supports(rule.conditionText);

    return true;
  };

  const visit = (rules: CSSRuleList, layer: string | null): void => {
    for (const rule of rules) {
      if (rule instanceof CSSStyleRule) {
        if (rule.selectorText.includes("::")) continue;
        order += 1;

        const entry = {
          selector: rule.selectorText,
          css: rule.style.cssText,
          rank: layerRank(layer) * 1_000_000 + order,
        };

        const classes = rule.selectorText.match(/\.[\w-]+/gu);

        if (classes === null) unclassed.push(entry);

        for (const name of new Set(classes ?? [])) {
          const list = byClass.get(name.slice(1)) ?? [];
          list.push(entry);
          byClass.set(name.slice(1), list);
        }

        continue;
      }

      if (rule instanceof CSSLayerBlockRule) visit(rule.cssRules, rule.name);
      else if (rule instanceof CSSGroupingRule && applies(rule)) visit(rule.cssRules, layer);
    }
  };

  for (const sheet of document.styleSheets) visit(sheet.cssRules, null);

  const split = (css: string): [string, string][] => {
    const out: [string, string][] = [];
    let depth = 0;
    let start = 0;

    for (let index = 0; index <= css.length; index += 1) {
      const character = css[index];

      if (character === "(") depth += 1;

      if (character === ")") depth -= 1;

      if ((character === ";" && depth === 0) || index === css.length) {
        const part = css.slice(start, index);
        const colon = part.indexOf(":");

        if (colon > 0) out.push([part.slice(0, colon).trim(), part.slice(colon + 1).trim()]);
        start = index + 1;
      }
    }

    return out;
  };

  const declarationsFor = (element: Element): Declaration[] => {
    const rules = [...element.classList].flatMap((name) => byClass.get(name) ?? []);

    const matched = [...new Set([...rules, ...unclassed])]
      .filter((rule) => {
        try {
          return element.matches(rule.selector);
        } catch {
          return false;
        }
      })
      .sort((a, b) => a.rank - b.rank);

    const inline = element.getAttribute("style");

    const all = matched.flatMap((rule) =>
      split(rule.css).map(([property, value]) => ({ property, value, selector: rule.selector })),
    );

    if (inline !== null)
      all.push(
        ...split(inline).map(([property, value]) => ({ property, value, selector: "style" })),
      );

    return all;
  };

  const painted = (element: Element, style: CSSStyleDeclaration): boolean => {
    if (
      ["IMG", "svg", "VIDEO", "CANVAS", "INPUT", "TEXTAREA", "SELECT", "HR"].includes(
        element.tagName,
      )
    )
      return true;

    if (style.backgroundColor !== "rgba(0, 0, 0, 0)" && style.backgroundColor !== "transparent")
      return true;

    if (style.backgroundImage !== "none" || style.boxShadow !== "none") return true;

    return (["Top", "Right", "Bottom", "Left"] as const).some(
      (side) =>
        parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0 &&
        style.getPropertyValue(`border-${side.toLowerCase()}-style`) !== "none" &&
        !style.getPropertyValue(`border-${side.toLowerCase()}-color`).endsWith(", 0)"),
    );
  };

  const nameRange = document.createRange();

  const onScreen = (node: Node): boolean => {
    nameRange.selectNodeContents(node);

    return [...nameRange.getClientRects()].some(
      (rect) =>
        rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth,
    );
  };

  const accessibleName = (element: Element): string => {
    const label = element.getAttribute("aria-label");

    if (label !== null) return label.slice(0, 60);
    const labelledBy = element.getAttribute("aria-labelledby");

    const labelled =
      labelledBy === null
        ? ""
        : labelledBy
            .split(/\s+/u)
            .map((id) => document.getElementById(id)?.textContent ?? "")
            .join(" ");

    if (labelled.trim() !== "") return labelled.trim().slice(0, 60);

    const first = document
      .createTreeWalker(element, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) =>
          (node.textContent ?? "").trim() === "" || !onScreen(node)
            ? NodeFilter.FILTER_SKIP
            : NodeFilter.FILTER_ACCEPT,
      })
      .nextNode();

    return (first?.textContent ?? "").replace(/\s+/gu, " ").trim().slice(0, 60);
  };

  const describe = (element: Element): string => {
    const slot = element.getAttribute("data-slot");
    const role = element.getAttribute("role");
    const label = element.getAttribute("aria-label");

    return `${element.tagName.toLowerCase()}${slot === null ? "" : `[data-slot=${slot}]`}${role === null ? "" : `[role=${role}]`}${label === null ? "" : `[aria-label="${label.slice(0, 40)}"]`}`;
  };

  const anchored = (element: Element): string => {
    const own = describe(element);

    for (let anchor = element.parentElement; anchor !== null; anchor = anchor.parentElement) {
      if (anchor.hasAttribute("data-slot") || anchor.hasAttribute("aria-label"))
        return `${describe(anchor)} > ${own}`;
    }

    return own;
  };

  const clips = new Map<Element, Edges>();
  const screen = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };

  const clipFor = (element: Element | null): Edges => {
    if (element === null || element === document.documentElement) return screen;
    const known = clips.get(element);

    if (known !== undefined) return known;
    const parent = clipFor(element.parentElement);
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();

    const clip =
      style.clip !== "auto"
        ? { left: rect.left, top: rect.top, right: rect.left, bottom: rect.top }
        : style.position === "fixed"
          ? screen
          : style.overflowX !== "visible" ||
              style.overflowY !== "visible" ||
              style.contain.includes("paint")
            ? {
                left: Math.max(parent.left, rect.left),
                top: Math.max(parent.top, rect.top),
                right: Math.min(parent.right, rect.right),
                bottom: Math.min(parent.bottom, rect.bottom),
              }
            : parent;

    clips.set(element, clip);

    return clip;
  };

  const followsText = (node: Element): boolean => {
    const first = node.getClientRects()[0];
    let block = node.parentElement;

    while (block !== null && getComputedStyle(block).display.startsWith("inline"))
      block = block.parentElement;

    if (first === undefined || block === null) return false;
    const range = document.createRange();
    range.setStart(block, 0);
    range.setEndBefore(node);

    return [...range.getClientRects()].some(
      (part) =>
        part.width > 0 &&
        part.bottom > first.top + 1 &&
        part.top < first.bottom - 1 &&
        part.right <= first.left + 0.5,
    );
  };

  const pastScrollClip = (node: Element, rect: DOMRect): boolean => {
    for (let current = node.parentElement; current !== null; current = current.parentElement) {
      const overflow = getComputedStyle(current).overflowX;

      if (
        (overflow === "auto" || overflow === "scroll") &&
        current.scrollWidth > current.clientWidth
      ) {
        const clip =
          current.getBoundingClientRect().left + current.clientLeft + current.clientWidth;

        return rect.right > clip + 0.01;
      }
    }

    return false;
  };

  const visibleIn = (
    rect: {
      left: number;
      top: number;
      right: number;
      bottom: number;
      width: number;
      height: number;
    },
    clip: Edges,
  ): boolean =>
    rect.width > 0 &&
    rect.height > 0 &&
    rect.right > clip.left + 0.5 &&
    rect.left < clip.right - 0.5 &&
    rect.bottom > clip.top + 0.5 &&
    rect.top < clip.bottom - 0.5;

  const placement = (parent: Element, rect: DOMRect): "centred" | "end-aligned" | null => {
    const style = getComputedStyle(parent);
    const box = parent.getBoundingClientRect();
    const start = box.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
    const end = box.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
    const before = rect.left - start;
    const after = end - rect.right;

    if (rect.width >= end - start - 0.01 || before <= 0.01) return null;

    if (Math.abs(before - after) <= 0.01) return "centred";

    return Math.abs(after) <= 0.01 ? "end-aligned" : null;
  };

  const resolveLength = (host: Element, css: string): number => {
    const probe = document.createElement("div");
    probe.style.cssText = `position:absolute;visibility:hidden;width:0;height:0;margin-left:${css}`;
    host.append(probe);
    const value = parseFloat(getComputedStyle(probe).marginLeft);
    probe.remove();

    if (Number.isNaN(value)) throw new Error(`The grid plan's length ${css} does not resolve.`);

    return round(value);
  };

  const fontProbe = document.createElement("div");
  fontProbe.style.cssText = "position:absolute;visibility:hidden;left:0;top:0;white-space:nowrap";
  document.body.append(fontProbe);
  const lineMetrics = new Map<string, LineMetrics>();

  const metricsFor = (style: CSSStyleDeclaration): LineMetrics => {
    const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize}/${style.lineHeight} ${style.fontFamily}`;
    const known = lineMetrics.get(font);

    if (known !== undefined) return known;
    fontProbe.style.font = font;
    fontProbe.innerHTML =
      '<span>Hxg</span><span style="display:inline-block;width:0;height:0;vertical-align:baseline"></span>';
    const top = fontProbe.getBoundingClientRect().top;
    const spans = fontProbe.querySelectorAll("span");

    const value = {
      content: (spans[0]?.getBoundingClientRect().top ?? top) - top,
      baseline: (spans[1]?.getBoundingClientRect().top ?? top) - top,
      lineHeight: fontProbe.getBoundingClientRect().height,
    };

    lineMetrics.set(font, value);

    return value;
  };

  const monoProbe = document.createElement("div");
  monoProbe.style.fontFamily = "var(--nyte-font-family-mono)";
  document.body.append(monoProbe);
  const monoFamily = getComputedStyle(monoProbe).fontFamily;
  monoProbe.style.fontFamily = "var(--nyte-font-family-sans)";
  const uiFamily = getComputedStyle(monoProbe).fontFamily;
  monoProbe.remove();

  const regionElements: { element: Element; planned: PlannedRegion; index: number }[] = [];

  for (const planned of plan.regions) {
    const locate = planned.locate;

    const found =
      locate.by === "selector"
        ? [...document.querySelectorAll(locate.selector)]
        : [...document.querySelectorAll(locate.within)].flatMap((within) => {
            const reading = [within, ...within.querySelectorAll("*")].filter((element) =>
              declarationsFor(element).some(
                (entry) =>
                  entry.property === "width" && entry.value.includes(`var(${locate.token})`),
              ),
            );

            const tallest = reading.sort(
              (a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height,
            )[0];

            return tallest === undefined ? [] : [tallest];
          });

    found
      .filter(
        (element) =>
          element.getClientRects().length > 0 && element.getBoundingClientRect().width > 0,
      )
      .forEach((element, index) => regionElements.push({ element, planned, index }));
  }

  const regionIndex = new Map(regionElements.map((entry, index) => [entry.element, index]));

  const exceptionSets = plan.exceptions.map((entry) => ({
    name: entry.name,
    elements: new Set(document.querySelectorAll(entry.selector)),
  }));

  const ids = new Map<Element, number>();
  const boxes: SnapBox[] = [];
  const keys = new Map<string, number>();

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);

  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (!(node instanceof Element) || node === fontProbe || node.id === "__grid_overlay") continue;

    if (node.closest("#__grid_overlay, svg svg") !== null) continue;

    if (node instanceof SVGElement && node.tagName !== "svg") continue;
    const style = getComputedStyle(node);

    if (style.display === "contents" || style.display === "none") continue;

    if (node.getClientRects().length === 0) continue;
    const rect = node.getBoundingClientRect();
    let parent: number | null = null;

    for (let up = node.parentElement; up !== null && parent === null; up = up.parentElement)
      parent = ids.get(up) ?? null;

    let region: number | null = null;

    for (let up: Element | null = node; up !== null && region === null; up = up.parentElement)
      region = regionIndex.get(up) ?? null;

    const map = node.computedStyleMap();
    const lengths: Record<string, number> = {};

    for (const property of LENGTHS) {
      const value = map.get(property);

      if (value instanceof CSSUnitValue && value.unit === "px")
        lengths[property] = round(value.value);
    }

    if (style.position === "static")
      for (const side of ["top", "right", "bottom", "left"]) delete lengths[side];

    if (!style.display.includes("flex") && !style.display.includes("grid")) {
      delete lengths["row-gap"];
      delete lengths["column-gap"];
    }

    const role = node.getAttribute("role");

    const control =
      ["BUTTON", "SELECT", "INPUT", "TEXTAREA"].includes(node.tagName) ||
      (role !== null && CONTROL_ROLES.has(role));

    const hasText = (node.textContent ?? "").trim() !== "";
    const facts: BoxFact[] = [];

    const placed =
      node.parentElement === null || style.position === "absolute" || style.position === "fixed"
        ? null
        : placement(node.parentElement, rect);

    if (placed !== null) facts.push(placed);

    if (style.borderTopLeftRadius.endsWith("%")) facts.push("circle");

    if (Math.min(rect.width, rect.height) <= 1) facts.push("hairline");

    if (rect.bottom >= innerHeight - 0.01 || rect.right >= innerWidth - 0.01)
      facts.push("window-edge");

    if (style.display === "inline") facts.push("inline-run");

    if (
      (style.backgroundColor !== "rgba(0, 0, 0, 0)" && style.backgroundColor !== "transparent") ||
      style.backgroundImage !== "none"
    )
      facts.push("background");

    if (style.display === "inline" && followsText(node)) facts.push("after-text");

    if (
      (node.tagName === "TD" || node.tagName === "TH") &&
      node.closest("table") !== null &&
      getComputedStyle(node.closest("table") ?? node).tableLayout === "auto"
    )
      facts.push("auto-table-column");

    if (pastScrollClip(node, rect)) facts.push("scrolled-overflow");

    const visible =
      visibleIn(rect, clipFor(node.parentElement)) &&
      style.clip === "auto" &&
      !(rect.width <= 1 && rect.height <= 1) &&
      style.visibility !== "hidden" &&
      node.checkVisibility({ opacityProperty: true });

    const descriptor = anchored(node);
    const occurrence = keys.get(descriptor) ?? 0;

    if (visible) keys.set(descriptor, occurrence + 1);
    const lineHeight = parseFloat(style.lineHeight);

    const flow = style.display.includes("grid")
      ? "grid"
      : style.display.includes("flex")
        ? style.flexDirection.startsWith("row")
          ? "row"
          : "column"
        : style.display.startsWith("inline")
          ? "inline"
          : "block";

    const id = boxes.length;
    ids.set(node, id);
    boxes.push({
      id,
      parent,
      tag: node.tagName.toLowerCase(),
      slot: node.getAttribute("data-slot"),
      role,
      name: accessibleName(node),
      key: visible ? `${descriptor}#${String(occurrence)}` : `${descriptor}#hidden`,
      rect: {
        left: round(rect.left),
        top: round(rect.top),
        width: round(rect.width),
        height: round(rect.height),
      },
      visible,
      region,
      painted: painted(node, style),
      control,
      iconOnly: control && !hasText && node.querySelector("svg") !== null,
      svg: node.tagName === "svg",
      icon: node.tagName === "svg" && node.parentElement?.hasAttribute("data-nyte-icon") === true,
      flow,
      outOfFlow: style.position === "absolute" || style.position === "fixed",
      lengths,
      font: {
        size: parseFloat(style.fontSize),
        lineHeight: Number.isNaN(lineHeight) ? null : lineHeight,
        mono: style.fontFamily === monoFamily,
        inline: style.display === "inline",
      },
      facts: [...new Set(facts)],
      exceptions: exceptionSets
        .filter((entry) => entry.elements.has(node))
        .map((entry) => entry.name),
      declarations: declarationsFor(node),
    });
  }

  const texts: SnapText[] = [];
  const textWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();

  for (let node = textWalker.nextNode(); node !== null; node = textWalker.nextNode()) {
    if (!(node instanceof Text) || node.data.trim() === "") continue;
    const parent = node.parentElement;
    const box = parent === null ? undefined : ids.get(parent);

    if (parent === null || box === undefined || boxes[box]?.visible !== true) continue;
    const style = getComputedStyle(parent);
    const metrics = metricsFor(style);
    const clip = clipFor(parent);

    const align =
      style.textAlign === "center"
        ? "centred"
        : style.textAlign === "end" || style.textAlign === "right"
          ? "end-aligned"
          : "start";

    range.selectNodeContents(node);

    for (const rect of range.getClientRects()) {
      if (rect.width <= 0.5 || !visibleIn(rect, clip)) continue;
      const lineTop = rect.top - metrics.content;
      texts.push({
        box,
        align,
        text: node.data.trim().slice(0, 40),
        left: round(rect.left),
        top: round(rect.top),
        width: round(rect.width),
        height: round(rect.height),
        lineTop: round(lineTop),
        lineHeight: round(metrics.lineHeight),
        baseline: round(lineTop + metrics.baseline),
      });
    }
  }

  for (const field of document.querySelectorAll("[data-placeholder]")) {
    const box = ids.get(field);

    if (
      box === undefined ||
      (field.textContent ?? "").trim() !== "" ||
      boxes[box]?.visible !== true
    )
      continue;
    const style = getComputedStyle(field);
    const metrics = metricsFor(style);
    const rect = field.getBoundingClientRect();
    const lineTop = rect.top + parseFloat(style.paddingTop) + parseFloat(style.borderTopWidth);
    const left = rect.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
    texts.push({
      box,
      align: "start",
      text: `placeholder: ${(field.getAttribute("data-placeholder") ?? "").slice(0, 28)}`,
      left: round(left),
      top: round(lineTop + metrics.content),
      width: round(rect.right - left),
      height: round(metrics.lineHeight),
      lineTop: round(lineTop),
      lineHeight: round(metrics.lineHeight),
      baseline: round(lineTop + metrics.baseline),
    });
  }

  fontProbe.remove();

  const regions = regionElements.map(({ element, planned, index }): SnapRegion => {
    const box = ids.get(element);

    if (box === undefined) throw new Error(`The ${planned.name} region has no box.`);

    const within = (selector: string | null): number[] =>
      selector === null
        ? []
        : [...element.querySelectorAll(selector)].flatMap((found) => {
            const id = ids.get(found);

            return id === undefined || boxes[id]?.visible !== true ? [] : [id];
          });

    return {
      name: planned.name,
      index,
      box,
      rect: boxes[box]?.rect ?? { left: 0, top: 0, width: 0, height: 0 },
      rails: planned.rails.map((rail) => ({
        name: rail.name,
        from: rail.from,
        offset: resolveLength(element, rail.css),
      })),
      pitch: planned.pitch === null ? null : resolveLength(element, planned.pitch),
      rows: within(planned.rows),
      centred: within(planned.centred),
    };
  });

  const picks = plan.picks.map((pick) => {
    const found = [...document.querySelectorAll(pick.selector)].find(
      (element) => boxes[ids.get(element) ?? -1]?.visible === true,
    );

    return { name: pick.name, box: found === undefined ? null : (ids.get(found) ?? null) };
  });

  const ends = [...document.querySelectorAll(plan.ends.pane)].flatMap((pane): PaneEnd[] => {
    const viewport = pane.querySelector(plan.ends.viewport);
    const rows = [...pane.querySelectorAll(plan.ends.row)];
    const content = rows[0]?.parentElement ?? null;
    const paneId = ids.get(pane);
    const contentId = content === null ? undefined : ids.get(content);

    if (viewport === null || content === null || paneId === undefined || contentId === undefined)
      return [];
    const view = viewport.getBoundingClientRect();
    const dock = pane.querySelector(plan.ends.dock)?.getBoundingClientRect();

    const last = rows
      .filter((row) => (row.textContent ?? "").trim() !== "")
      .sort(
        (a, b) => Number(b.getAttribute("data-index")) - Number(a.getAttribute("data-index")),
      )[0];

    const lastText = (() => {
      if (last === undefined) return undefined;
      const walker = document.createTreeWalker(last, NodeFilter.SHOW_TEXT);
      let found: Text | undefined;

      for (let node = walker.nextNode(); node !== null; node = walker.nextNode())
        if (node instanceof Text && node.data.trim() !== "") found = node;

      return found;
    })();

    if (lastText !== undefined) range.selectNodeContents(lastText);
    const line = lastText === undefined ? undefined : [...range.getClientRects()].at(-1);

    return [
      {
        pane: paneId,
        content: contentId,
        viewTop: round(view.top),
        viewBottom: round(dock === undefined ? view.bottom : Math.min(view.bottom, dock.top)),
        lastLine:
          last === undefined || line === undefined
            ? null
            : {
                index: Number(last.getAttribute("data-index")),
                row: boxes[ids.get(last) ?? -1]?.rect ?? { left: 0, top: 0, width: 0, height: 0 },
                rect: {
                  left: round(line.left),
                  top: round(line.top),
                  width: round(line.width),
                  height: round(line.height),
                },
              },
      },
    ];
  });

  return {
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    ends,
    fonts: { ui: uiFamily, mono: monoFamily, uiLoaded: document.fonts.check(`13px ${uiFamily}`) },
    regions,
    boxes,
    texts,
    picks,
  };
}

export interface Mark {
  readonly label: string;
  readonly rect: Rect;
  /** A line the mark should have met: a rail's x or a row's expected line top. */
  readonly target: { readonly axis: "x" | "y"; readonly at: number } | null;
}

/** Outlines each violation with its number, over the page, until `clearOverlay`. */
export function drawOverlay(marks: readonly Mark[]): void {
  document.getElementById("__grid_overlay")?.remove();
  const ns = "http://www.w3.org/2000/svg";
  const root = document.createElement("div");
  root.id = "__grid_overlay";
  root.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", String(innerWidth));
  svg.setAttribute("height", String(innerHeight));
  root.append(svg);

  const add = (tag: string, attributes: Record<string, string | number>): SVGElement => {
    const element = document.createElementNS(ns, tag);

    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    svg.append(element);

    return element;
  };

  for (const mark of marks) {
    const rect = mark.rect;
    add("rect", {
      x: rect.left,
      y: rect.top,
      width: Math.max(rect.width, 1),
      height: Math.max(rect.height, 1),
      fill: "rgba(255,40,40,0.12)",
      stroke: "#ff2828",
      "stroke-width": 1,
    });

    if (mark.target !== null) {
      const line =
        mark.target.axis === "x"
          ? {
              x1: mark.target.at,
              x2: mark.target.at,
              y1: rect.top - 4,
              y2: rect.top + rect.height + 4,
            }
          : {
              x1: rect.left - 4,
              x2: rect.left + rect.width + 4,
              y1: mark.target.at,
              y2: mark.target.at,
            };

      add("line", { ...line, stroke: "#00d0ff", "stroke-width": 1 });
    }

    const width = mark.label.length * 5.6 + 6;
    add("rect", {
      x: rect.left,
      y: rect.top - 11,
      width,
      height: 11,
      rx: 2,
      fill: "rgba(0,0,0,0.8)",
    });

    const text = add("text", {
      x: rect.left + 3,
      y: rect.top - 2.5,
      fill: "#ff8080",
      "font-size": 9,
      "font-family": "Menlo, monospace",
    });

    text.textContent = mark.label;
  }

  document.body.append(root);
}

export function clearOverlay(): void {
  document.getElementById("__grid_overlay")?.remove();
}
