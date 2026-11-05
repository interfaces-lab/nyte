import type { Rect, SnapBox, SnapRegion, SnapText, Snapshot } from "./collect.ts";
import {
  ALIGNMENTS,
  CHROME_BAR_TOKENS,
  GRID_RULES,
  REGIONS,
  SCALE,
  spell,
  termsIn,
} from "./rules.ts";
import type { BoxFact, Pick, RegionName, RuleId } from "./rules.ts";
import { LONGHANDS } from "./cause.ts";
import {
  boxTree,
  descends,
  EPSILON,
  even,
  heightOrigin,
  heightParts,
  near,
  offsetParts,
  stepParts,
  whole,
} from "./geometry.ts";
import type { Part } from "./geometry.ts";

/** What the cause resolver looks up for a finding. */
export type CauseQuery =
  | { readonly kind: "property"; readonly box: number; readonly property: string }
  | { readonly kind: "offset"; readonly parts: readonly Part[]; readonly terms: readonly string[] }
  /** A length built from parts: the first part off `grid` is the cause. */
  | { readonly kind: "sum"; readonly parts: readonly Part[]; readonly grid: 1 | 2 }
  | { readonly kind: "none"; readonly reason: string };

export interface Finding {
  /** Findings with one group are one miss, counted once: a box and its own text, or boxes one fraction moved. */
  readonly group: string;
  /** Tells apart two findings of one rule and property on one element, without a coordinate: a rail or alignment name, a text's index. */
  readonly detail: string;
  readonly rule: RuleId;
  readonly region: RegionName | "window";
  readonly box: number;
  readonly property: string;
  readonly value: string;
  readonly expected: string;
  readonly rect: Rect;
  readonly target: { readonly axis: "x" | "y"; readonly at: number } | null;
  readonly cause: CauseQuery;
}

export interface CheckResult {
  readonly findings: readonly Finding[];
  /**
   * Misses not reported because a reported one covers them: later members of a group, and boxes whose
   * half pixel is their parent's. Fixing the cover reveals them, which isn't a new miss.
   */
  readonly masked: readonly Finding[];
  readonly exceptionHits: ReadonlyMap<string, number>;
  /** How far each list row's first line box sits from its row's centre, in px. */
  readonly centring: readonly number[];
}

/** Measured on the tree this check landed with: every centred row's line box sat exactly at centre. */
export const LINE_TOLERANCE = 0;

const inSet = (set: readonly number[], value: number): boolean =>
  set.some((step) => near(step, value));

const px = (value: number): string => `${String(Math.round(value * 100) / 100)}px`;

const SPACING = [
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
] as const;

const INSETS = ["top", "right", "bottom", "left"] as const;

const CORNERS = [
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-right-radius",
  "border-bottom-left-radius",
] as const;

const TYPE_SIZES: ReadonlySet<number> = new Set(
  [...SCALE.type, ...SCALE.code].map((pair) => pair[0]),
);

/**
 * Checks one state's snapshot against the rules, and reports each miss once, where it starts.
 *
 * - Controls and bars have their own sets, so box-grid skips them rather than count one miss twice.
 * - A half pixel is reported only where the fraction starts; a box inherits its parent's otherwise.
 *   An off-grid height that comes from content is traced to the deepest child that is off the grid.
 * - When a type pair is broken, the half declared nearer the text is the one that broke it.
 * - An end-aligned box's start follows its width, but its end edge is still checked against the rails.
 * - An odd inline padding or margin passes when it puts the box's content or edge on one of its region's rails.
 */
/** The roles that make a button a list or header row. */
const ROW_ROLES = new Set(["row", "listitem", "treeitem", "option"]);

export function check(snapshot: Snapshot): CheckResult {
  const tree = boxTree(snapshot);
  const boxes = snapshot.boxes;
  const declaredRows = new Set(snapshot.regions.flatMap((region) => region.rows));

  const hits = new Map<string, number>();
  const findings: Finding[] = [];

  const regionName = (box: SnapBox): RegionName | "window" =>
    box.region === null ? "window" : (snapshot.regions[box.region]?.name ?? "window");

  const exempt = (
    rule: RuleId,
    box: SnapBox,
    facts: { readonly extra?: readonly BoxFact[]; readonly ignore?: readonly BoxFact[] } = {},
  ): boolean => {
    const known = [...box.facts, ...(facts.extra ?? [])].filter(
      (fact) => !(facts.ignore ?? []).includes(fact),
    );

    const exception = GRID_RULES[rule].exceptions.find((entry) => {
      switch (entry.match.by) {
        case "selector":
          return box.exceptions.includes(entry.name);
        case "token": {
          const token = entry.match.token;

          return box.declarations.some((declaration) =>
            declaration.value.includes(`var(${token})`),
          );
        }

        case "fact":
          return known.includes(entry.match.fact);
        default: {
          const exhaustive: never = entry.match;

          return exhaustive;
        }
      }
    });

    if (exception === undefined) return false;
    hits.set(`${rule}/${exception.name}`, (hits.get(`${rule}/${exception.name}`) ?? 0) + 1);

    return true;
  };

  const masked: Finding[] = [];

  const add = (
    finding: Omit<Finding, "region" | "rect" | "group" | "detail"> & {
      readonly rect?: Rect;
      readonly group?: string;
      readonly detail?: string;
    },
    into: Finding[] = findings,
  ): void => {
    const box = boxes[finding.box];

    if (box === undefined) return;
    into.push({
      ...finding,
      group: finding.group ?? `${finding.rule}|${String(finding.box)}|${finding.property}`,
      detail: finding.detail ?? "",
      region: regionName(box),
      rect: finding.rect ?? box.rect,
    });
  };

  const visible = boxes.filter((box) => box.visible);

  for (const box of visible) {
    checkSpacing(box);
    checkSizes(box);
    checkRadius(box);
    checkHalfPixel(box);
  }

  checkType();
  const centring = checkRegions();
  checkAlignments();
  checkEnds();

  const grouped = dedupe(findings);

  return {
    findings: grouped.kept,
    masked: [...grouped.dropped, ...masked],
    exceptionHits: hits,
    centring,
  };

  function checkSpacing(box: SnapBox): void {
    for (const property of SPACING) {
      const value = box.lengths[property];

      if (value === undefined || inSet(SCALE.spacing, Math.abs(value))) continue;

      const extra: BoxFact[] = [
        ...(centresLine(box, property) ? ["line-centring" as const] : []),
        ...(scriptSets(box, property) ? ["script-length" as const] : []),
        ...(insetsToRail(box, property) ? ["rail-inset" as const] : []),
      ];

      if (exempt("spacing", box, { extra })) continue;
      add({
        rule: "spacing",
        box: box.id,
        property,
        value: px(value),
        expected: "a step of the spacing scale",
        target: null,
        cause: { kind: "property", box: box.id, property },
      });
    }

    if (!box.outOfFlow) return;

    for (const property of INSETS) {
      const value = box.lengths[property];

      if (value === undefined) continue;
      const size = Math.abs(value);

      if (inSet(SCALE.spacing, size) || even(size)) continue;

      if (exempt("spacing", box, { extra: scriptSets(box, property) ? ["script-length"] : [] }))
        continue;
      add({
        rule: "spacing",
        box: box.id,
        property,
        value: px(value),
        expected: "a spacing step or an even length",
        target: null,
        cause: { kind: "property", box: box.id, property },
      });
    }
  }

  function insetsToRail(box: SnapBox, property: string): boolean {
    const region = box.region === null ? undefined : snapshot.regions[box.region];

    if (region === undefined) return false;
    const right = region.rect.left + region.rect.width;

    const edge =
      property === "padding-left"
        ? box.rect.left +
          (box.lengths["border-left-width"] ?? 0) +
          (box.lengths[property] ?? 0) -
          region.rect.left
        : property === "padding-right"
          ? right -
            (box.rect.left +
              box.rect.width -
              (box.lengths["border-right-width"] ?? 0) -
              (box.lengths[property] ?? 0))
          : property === "margin-left"
            ? box.rect.left - region.rect.left
            : property === "margin-right"
              ? right - (box.rect.left + box.rect.width)
              : null;

    if (edge === null) return false;
    const from = property.endsWith("left") ? "start" : "end";

    return region.rails.some((rail) => rail.from === from && near(rail.offset, edge));
  }

  function scriptSets(box: SnapBox, property: string): boolean {
    const names = LONGHANDS.get(property) ?? [property];

    return box.declarations.some(
      (entry) => entry.selector === "style" && names.includes(entry.property),
    );
  }

  function paintedControl(control: SnapBox): SnapBox {
    if (framed(control)) return control;

    for (let id = control.parent; id !== null; id = boxes[id]?.parent ?? null) {
      const ancestor = boxes[id];

      if (ancestor === undefined) return control;

      if (!framed(ancestor)) continue;

      const other =
        !near(control.rect.height, innerHeight(ancestor)) ||
        boxes.some(
          (entry) =>
            entry.control && entry.id !== control.id && descends(tree, entry.id, ancestor.id),
        );

      return other ? control : ancestor;
    }

    return control;
  }

  function rowButton(box: SnapBox): boolean {
    const row = box.parent === null ? undefined : boxes[box.parent];

    if (row === undefined || !(box.tag === "button" || box.role === "button")) return false;

    if (![box, row].some((entry) => ROW_ROLES.has(entry.role ?? "") || declaredRows.has(entry.id)))
      return false;

    const others = boxes.filter(
      (entry) =>
        entry.control && entry.visible && entry.id !== box.id && descends(tree, entry.id, row.id),
    );

    return (
      row.rect.height >= Math.min(...SCALE.rows) &&
      near(box.rect.height, innerHeight(row)) &&
      others.length > 0 &&
      others.every((entry) => entry.rect.width < box.rect.width)
    );
  }

  function innerHeight(box: SnapBox): number {
    return (
      box.rect.height -
      ["border-top-width", "border-bottom-width", "padding-top", "padding-bottom"].reduce(
        (sum, property) => sum + (box.lengths[property] ?? 0),
        0,
      )
    );
  }

  function framed(box: SnapBox): boolean {
    return (
      box.facts.includes("background") ||
      box.facts.includes("shadow") ||
      ["top", "right", "bottom", "left"].some(
        (side) => (box.lengths[`border-${side}-width`] ?? 0) > 0,
      )
    );
  }

  function multiLine(box: SnapBox): boolean {
    const tops = new Set(
      snapshot.texts
        .filter((text) => descends(tree, text.box, box.id))
        .map((text) => Math.round(text.lineTop)),
    );

    return tops.size > 1;
  }

  function centresLine(box: SnapBox, property: string): boolean {
    if (property !== "padding-top" && property !== "padding-bottom") return false;
    const top = box.lengths["padding-top"] ?? 0;
    const bottom = box.lengths["padding-bottom"] ?? 0;
    const line = box.font.lineHeight;

    const borders =
      (box.lengths["border-top-width"] ?? 0) + (box.lengths["border-bottom-width"] ?? 0);

    return (
      line !== null && near(top, bottom) && near(box.rect.height, line + top + bottom + borders)
    );
  }

  function checkSizes(box: SnapBox): void {
    if (box.svg) {
      if (!box.icon) return;
      const square = near(box.rect.width, box.rect.height);

      if ((inSet(SCALE.icons, box.rect.width) && square) || exempt("icon-size", box)) return;
      add({
        rule: "icon-size",
        box: box.id,
        property: "size",
        value: `${px(box.rect.width)} × ${px(box.rect.height)}`,
        expected: `a square of ${spell(SCALE.icons)}`,
        target: null,
        cause: { kind: "property", box: box.id, property: "width" },
      });

      return;
    }

    const barProperty = ["height", "min-height"].find((property) =>
      box.declarations.some(
        (entry) =>
          entry.property === property &&
          CHROME_BAR_TOKENS.some((token) => entry.value.includes(`var(${token})`)),
      ),
    );

    if (
      barProperty !== undefined &&
      !near(box.rect.height, SCALE.chromeBar) &&
      !exempt("bar-size", box)
    )
      add({
        rule: "bar-size",
        box: box.id,
        property: barProperty,
        value: px(box.rect.height),
        expected: px(SCALE.chromeBar),
        target: null,
        cause: { kind: "property", box: box.id, property: barProperty },
      });

    if (box.control && !box.font.inline) {
      const measured = paintedControl(box);
      const heights = rowButton(box) ? [...SCALE.rows, ...SCALE.bars] : SCALE.controls;
      const tall = inSet(heights, measured.rect.height);
      const square = !box.iconOnly || near(measured.rect.width, measured.rect.height);

      if (
        !(tall && square) &&
        !exempt("control-size", measured, { extra: multiLine(measured) ? ["multi-line"] : [] })
      )
        add({
          rule: "control-size",
          box: measured.id,
          property: tall ? "width" : "height",
          value: `${px(measured.rect.width)} × ${px(measured.rect.height)}`,
          expected: tall ? "as wide as it is tall" : `${spell(heights)} tall`,
          target: null,
          cause: { kind: "property", box: measured.id, property: tall ? "width" : "height" },
        });
    }

    const ownSet = (box.control && !box.font.inline) || barProperty !== undefined;
    const declaredHeight = box.lengths.height !== undefined;

    for (const [property, value, checked] of [
      ["height", box.rect.height, !ownSet && (box.painted || declaredHeight)],
      ["width", box.rect.width, !box.iconOnly && box.lengths.width !== undefined],
    ] as const) {
      if (
        !checked ||
        even(value) ||
        exempt("box-grid", box, { extra: scriptSets(box, property) ? ["script-length"] : [] })
      )
        continue;

      add({
        rule: "box-grid",
        box: box.id,
        property,
        value: px(value),
        expected: "an even number of pixels",
        target: null,
        group:
          property === "height" && !declaredHeight
            ? `box-grid|height|${String(heightOrigin(tree, box).id)}`
            : undefined,
        cause:
          property === "height" && !declaredHeight
            ? { kind: "sum", parts: heightParts(tree, heightOrigin(tree, box)), grid: 2 }
            : { kind: "property", box: box.id, property },
      });
    }
  }

  function checkRadius(box: SnapBox): void {
    if (!box.painted) return;

    const corner = CORNERS.find((property) => {
      const value = box.lengths[property];

      return value !== undefined && !inSet(SCALE.radii, value);
    });

    if (corner === undefined || exempt("radius", box)) return;
    add({
      rule: "radius",
      box: box.id,
      property: corner,
      value: px(box.lengths[corner] ?? 0),
      expected: spell(SCALE.radii),
      target: null,
      cause: { kind: "property", box: box.id, property: corner },
    });
  }

  function railEdge(box: SnapBox): boolean {
    if (box.painted && !box.svg) return true;

    if (box.control) return box.iconOnly;

    return box.svg && !hasAncestor(box, (ancestor) => ancestor.control);
  }

  function hasAncestor(box: SnapBox, test: (ancestor: SnapBox) => boolean): boolean {
    for (let current = box.parent; current !== null; current = boxes[current]?.parent ?? null)
      if (boxes[current] !== undefined && test(boxes[current])) return true;

    return false;
  }

  function checkHalfPixel(box: SnapBox): void {
    if (!(box.painted || box.control || box.svg)) return;
    const parent = box.parent === null ? undefined : boxes[box.parent];
    const fraction = (value: number): number => Math.round((value - Math.floor(value)) * 100) / 100;

    const edges = [
      ["x", box.rect.left, parent?.rect.left],
      ["y", box.rect.top, parent?.rect.top],
    ] as const;

    for (const [axis, value, from] of edges) {
      if (whole(value)) continue;
      const inherited = from !== undefined && near(fraction(value), fraction(from));

      if (
        !inherited &&
        exempt("half-pixel", box, {
          ignore:
            axis === "y"
              ? ["centred", "end-aligned", "auto-table-column"]
              : box.facts.includes("after-text")
                ? []
                : ["inline-run"],
        })
      )
        continue;

      const parts = offsetParts(tree, box, axis === "x" ? "left" : "top", null);
      const origin = parts.find((part) => !whole(part.px));
      add(
        {
          rule: "half-pixel",
          group: `half-pixel|${axis}|${String(origin?.box ?? box.id)}`,
          box: box.id,
          property: axis,
          value: px(value),
          expected: "a whole pixel",
          target: null,
          cause: { kind: "sum", parts, grid: 1 },
        },
        inherited ? masked : findings,
      );
    }
  }

  function checkType(): void {
    const owners = new Set<number>();
    const inlineSizes = new Set<number>();

    for (const text of snapshot.texts) {
      const box = boxes[text.box];

      if (box === undefined) continue;
      const owner = blockOwner(box);

      if (owner !== undefined) owners.add(owner.id);

      if (box.font.inline && owner !== undefined && !near(box.font.size, owner.font.size))
        inlineSizes.add(box.id);
    }

    for (const id of [...owners].sort((a, b) => a - b)) {
      const box = boxes[id];

      if (box === undefined) continue;

      const pairs: readonly (readonly [number, number])[] = box.font.mono
        ? [...SCALE.code, ...SCALE.type]
        : SCALE.type;

      const line = box.font.lineHeight;

      const paired =
        line !== null &&
        pairs.some(([size, height]) => near(size, box.font.size) && near(height, line));

      if (paired || exempt("type-pair", box)) continue;

      const property =
        declaredAt(box, "font-size") < declaredAt(box, "line-height") ? "font-size" : "line-height";

      add({
        rule: "type-pair",
        box: id,
        property,
        value: `${px(box.font.size)}/${line === null ? "normal" : px(line)}`,
        expected: spell(
          pairs.map(([size, height]) => `${String(size)}/${String(height)}`),
          "",
        ),
        target: null,
        cause: { kind: "property", box: id, property },
      });
    }

    for (const id of [...inlineSizes].sort((a, b) => a - b)) {
      const box = boxes[id];

      if (box === undefined || TYPE_SIZES.has(box.font.size) || exempt("type-pair", box)) continue;
      add({
        rule: "type-pair",
        box: id,
        property: "font-size",
        value: px(box.font.size),
        expected: "a size from the type pairs",
        target: null,
        cause: { kind: "property", box: id, property: "font-size" },
      });
    }
  }

  function declaredAt(box: SnapBox, property: string): number {
    const names = LONGHANDS.get(property) ?? [property];
    let depth = 0;

    for (let current: SnapBox | undefined = box; current !== undefined; depth += 1) {
      if (current.declarations.some((entry) => names.includes(entry.property))) return depth;
      current = current.parent === null ? undefined : boxes[current.parent];
    }

    return Infinity;
  }

  function blockOwner(box: SnapBox): SnapBox | undefined {
    let current: SnapBox | undefined = box;

    while (current !== undefined && current.font.inline)
      current = current.parent === null ? undefined : boxes[current.parent];

    return current;
  }

  function checkRegions(): number[] {
    const errors: number[] = [];

    for (const region of snapshot.regions) {
      const spec = REGIONS.find((entry) => entry.name === region.name);

      if (spec === undefined) continue;
      checkRails(
        region,
        spec.rails.map((rail) => ({ ...rail, terms: termsIn(rail.offset) })),
      );

      for (const id of region.centred) {
        const box = boxes[id];

        if (box === undefined) continue;

        const error =
          box.rect.top + box.rect.height / 2 - (region.rect.top + region.rect.height / 2);

        if (Math.abs(error) <= EPSILON || exempt("rhythm", box)) continue;
        add({
          rule: "rhythm",
          box: id,
          property: "centre",
          value: `${px(error)} off centre`,
          expected: `centred on the ${region.name}`,
          target: { axis: "y", at: region.rect.top + region.rect.height / 2 },
          cause: { kind: "offset", parts: offsetParts(tree, box, "top", region.box), terms: [] },
        });
      }

      if (spec.rhythm === null) continue;
      const pitch = region.pitch;
      const terms = spec.rhythm.pitch === null ? [] : termsIn(spec.rhythm.pitch);

      const rows = region.rows
        .flatMap((id) => boxes[id] ?? [])
        .sort((a, b) => a.rect.top - b.rect.top);

      rows.forEach((row, index) => {
        const centre = rowCentring(row);

        if (centre !== null) {
          errors.push(centre.error);

          if (Math.abs(centre.error) > LINE_TOLERANCE + EPSILON && !exempt("rhythm", row))
            add({
              rule: "rhythm",
              box: row.id,
              property: "line-top",
              value: px(centre.text.lineTop),
              expected: `${px(centre.expected)}, the row's centre`,
              target: { axis: "y", at: centre.expected },
              cause: {
                kind: "offset",
                parts: offsetParts(tree, boxes[centre.text.box] ?? row, "top", row.id),
                terms: [],
              },
            });
        }

        const previous = rows[index - 1];

        if (previous === undefined || pitch === null) return;
        const step = row.rect.top - previous.rect.top;

        if (Math.abs(step - pitch) <= EPSILON || Math.abs(step - pitch) > SCALE.railNear) return;

        if (exempt("rhythm", row)) return;
        add({
          rule: "rhythm",
          box: row.id,
          property: "row-step",
          value: px(step),
          expected: px(pitch),
          target: { axis: "y", at: previous.rect.top + pitch },
          cause: { kind: "offset", parts: stepParts(tree, previous, row), terms },
        });
      });
    }

    return errors;
  }

  function rowCentring(row: SnapBox): { text: SnapText; expected: number; error: number } | null {
    const text = snapshot.texts.find((entry) => descends(tree, entry.box, row.id));

    if (text === undefined) return null;
    const expected = row.rect.top + (row.rect.height - text.lineHeight) / 2;

    return { text, expected, error: Math.round((text.lineTop - expected) * 100) / 100 };
  }

  function checkRails(
    region: SnapRegion,
    rails: readonly {
      readonly name: string;
      readonly from: "start" | "end";
      readonly terms: readonly string[];
    }[],
  ): void {
    if (rails.length === 0) return;

    const resolved = rails.flatMap((rail) => {
      const offset = region.rails.find((entry) => entry.name === rail.name)?.offset;

      return offset === undefined ? [] : [{ ...rail, offset }];
    });

    const left = region.rect.left;
    const right = region.rect.left + region.rect.width;
    const inRegion = snapshot.regions.indexOf(region);

    const candidates = [
      ...visible
        .filter((box) => box.region === inRegion && box.id !== region.box && railEdge(box))
        .flatMap((box) => [
          {
            box,
            from: "start" as const,
            offset: box.rect.left - left,
            top: box.rect.top,
            text: null,
            textIndex: 0,
          },
          {
            box,
            from: "end" as const,
            offset: right - (box.rect.left + box.rect.width),
            top: box.rect.top,
            text: null,
            textIndex: 0,
          },
        ]),
      ...snapshot.texts.flatMap((text, position) => {
        const box = boxes[text.box];

        const textIndex = snapshot.texts
          .slice(0, position)
          .filter((entry) => entry.box === text.box).length;

        return box === undefined || box.region !== inRegion || box.facts.includes("background")
          ? []
          : [
              {
                box,
                from: "start" as const,
                offset: text.left - left,
                top: text.top,
                text,
                textIndex,
              },
            ];
      }),
    ];

    for (const candidate of candidates) {
      const own = resolved.filter((rail) => rail.from === candidate.from);

      if (own.some((rail) => near(rail.offset, candidate.offset))) continue;

      const overflows =
        candidate.from === "end" &&
        candidate.offset < -EPSILON &&
        candidate.box.facts.includes("after-text");

      const rail = own
        .flatMap((entry) => {
          const distance = Math.abs(entry.offset - candidate.offset);

          return distance <= SCALE.railNear || overflows ? [{ entry, distance }] : [];
        })
        .sort((a, b) => a.distance - b.distance)[0]?.entry;

      if (rail === undefined) continue;

      const textFacts: BoxFact[] =
        candidate.text === null || candidate.text.align === "start" ? [] : [candidate.text.align];

      const scrolled: BoxFact[] =
        candidate.from === "end" &&
        hasAncestor(candidate.box, (ancestor) => ancestor.facts.includes("h-scroller"))
          ? ["scrolled-overflow"]
          : [];

      if (
        exempt("rail", candidate.box, {
          extra: [...textFacts, ...scrolled],
          ignore: [
            ...(candidate.from === "end" ? (["end-aligned"] as const) : []),
            ...(candidate.from === "start" || overflows ? (["after-text"] as const) : []),
          ],
        })
      )
        continue;
      const at = candidate.from === "start" ? left + rail.offset : right - rail.offset;
      add({
        rule: "rail",
        detail: `${rail.name}${candidate.text === null ? "" : `|text ${String(candidate.textIndex)}`}`,
        group: `rail|${String(inRegion)}|${rail.name}|${String(Math.round(candidate.top))}|${String(Math.round(candidate.offset * 100))}`,
        box: candidate.box.id,
        property:
          candidate.text !== null ? "text-start" : candidate.from === "start" ? "left" : "right",
        value: `${px(candidate.offset)} from the ${candidate.from}`,
        expected: `${px(rail.offset)}, rail ${rail.name}`,
        target: { axis: "x", at },
        cause: {
          kind: "offset",
          parts: offsetParts(
            tree,
            candidate.box,
            candidate.from === "start" ? "left" : "right",
            region.box,
            candidate.text !== null,
          ),
          terms: rail.terms,
        },
      });
    }
  }

  function checkAlignments(): void {
    for (const alignment of ALIGNMENTS) {
      const a = pickValues(alignment.a, alignment.axis)[0];

      if (a === undefined || exempt("align", a.box)) continue;

      for (const b of pickValues(alignment.b, alignment.axis)) {
        if (near(a.value, b.value)) continue;
        add({
          rule: "align",
          detail: alignment.name,
          group: `align|${alignment.name}|${String(a.box.id)}|${String(b.box.id)}`,
          box: a.box.id,
          property: alignment.axis === "x" ? "left" : "baseline",
          value: px(a.value),
          expected: `${px(b.value)}, ${alignment.name}: ${b.label}`,
          target: { axis: alignment.axis, at: b.value },
          cause: { kind: "none", reason: `${alignment.why} Compared with ${b.label}.` },
        });
      }
    }
  }

  function checkEnds(): void {
    for (const end of snapshot.ends) {
      const content = boxes[end.content];
      const line = end.lastLine?.rect;

      if (content === undefined || line === undefined) continue;
      const bottom = line.top + line.height;
      const inView = line.top >= end.viewTop - EPSILON && bottom <= end.viewBottom + EPSILON;

      if (inView || exempt("end-in-view", content)) continue;

      add({
        rule: "end-in-view",
        box: end.content,
        property: "last-line",
        value:
          bottom > end.viewBottom
            ? `the last line ends ${px(bottom - end.viewBottom)} below the view`
            : `the last line sits ${px(end.viewTop - line.top)} above the view`,
        expected: `inside the view, ${px(end.viewTop)} to ${px(end.viewBottom)}`,
        rect: end.lastLine?.row,
        target: { axis: "y", at: end.viewTop },
        cause: {
          kind: "none",
          reason:
            "The transcript opens scrolled past its last message, so the view shows the end padding and an empty row.",
        },
      });
    }
  }

  function pickValues(
    pick: Pick,
    axis: "x" | "y",
  ): { value: number; box: SnapBox; label: string }[] {
    if (pick.kind === "box")
      return boxesByPick(pick.selector).flatMap((box) => lineValue(box, axis, pick.name) ?? []);

    const value = pickValue(pick, axis);

    return value === null ? [] : [value];
  }

  function pickValue(
    pick: Exclude<Pick, { kind: "box" }>,
    axis: "x" | "y",
  ): { value: number; box: SnapBox; label: string } | null {
    const region = snapshot.regions.find((entry) => entry.name === pick.region);

    if (region === undefined) return null;
    const regionBox = boxes[region.box];

    if (regionBox === undefined) return null;

    if (pick.kind === "rail") {
      const rail = region.rails.find((entry) => entry.name === pick.rail);

      if (rail === undefined) return null;

      const value =
        rail.from === "start"
          ? region.rect.left + rail.offset
          : region.rect.left + region.rect.width - rail.offset;

      return { value, box: regionBox, label: `rail ${pick.rail} of ${pick.region}` };
    }

    const box = region.rows
      .flatMap((id) => boxes[id] ?? [])
      .sort((x, y) => x.rect.top - y.rect.top)[0];

    return box === undefined ? null : lineValue(box, axis, `the first row of ${pick.region}`);
  }

  function lineValue(
    box: SnapBox,
    axis: "x" | "y",
    label: string,
  ): { value: number; box: SnapBox; label: string } | null {
    if (axis === "x") return { value: box.rect.left, box, label };
    const text = snapshot.texts.find((entry) => descends(tree, entry.box, box.id));

    return text === undefined ? null : { value: text.baseline, box, label };
  }

  function boxesByPick(selector: string): SnapBox[] {
    const ids = snapshot.picks.find((pick) => pick.name === selector)?.boxes ?? [];

    return ids.flatMap((id) => boxes[id] ?? []);
  }
}

function dedupe(findings: readonly Finding[]) {
  const seen = new Set<string>();
  const kept: Finding[] = [];
  const dropped: Finding[] = [];

  for (const finding of findings) {
    (seen.has(finding.group) ? dropped : kept).push(finding);
    seen.add(finding.group);
  }

  return { kept, dropped };
}
