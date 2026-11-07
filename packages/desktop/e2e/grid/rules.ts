/**
 * The spatial grid the rendered desktop app is checked against: the scale, every rule with its named
 * exceptions, and each region's rails and row rhythm. Rails and pitches are expressions over StyleX
 * handles, so they move with the tokens instead of pinning today's values.
 */

export const SCALE = {
  spacing: [0, 1, 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48, 64],
  grid: 2,
  controls: [16, 20, 24, 28, 32, 36],
  /** Cursor's Glass bar: the titlebar and every pane header. */
  chromeBar: 40,
  /** The row scale: the control heights at or above the 24px target. */
  rows: [24, 28, 32, 36],
  bars: [40, 44, 48],
  radii: [0, 4, 6, 8, 12, 14, 16, 9999],
  icons: [10, 12, 14, 16, 20],
  type: [
    [11, 14],
    [12, 16],
    [13, 18],
    [15, 24],
    [19, 24],
    [24, 32],
    [28, 34],
  ],
  code: [[12, 18]],
  /** An edge this far from a rail is meant to sit on it. */
  railNear: 4,
} as const;

/** A list of steps as a sentence fragment: "10, 12 or 14px". */
export const spell = (values: readonly (number | string)[], unit = "px"): string =>
  values.length < 2
    ? `${values.join("")}${unit}`
    : `${values.slice(0, -1).join(", ")} or ${String(values.at(-1))}${unit}`;

const pairs = (list: readonly (readonly [number, number])[]): string[] =>
  list.map(([size, line]) => `${String(size)}/${String(line)}`);

/** Heights that make a box a chrome bar, read from the declaration that sizes it. */
export const CHROME_BAR_TOKENS = [
  "--nyte-titlebar-height",
  "--nyte-conversation-header-height",
  "--nyte-workbench-header-height",
] as const;

export type RuleId =
  | "spacing"
  | "box-grid"
  | "control-size"
  | "bar-size"
  | "radius"
  | "icon-size"
  | "type-pair"
  | "half-pixel"
  | "rail"
  | "rhythm"
  | "align"
  | "end-in-view";

/** A fact about a box, for exceptions no selector can name. */
export type BoxFact =
  | "centred"
  | "end-aligned"
  | "circle"
  | "hairline"
  | "window-edge"
  | "inline-run"
  | "script-length"
  | "multi-line"
  | "line-centring"
  | "rail-inset"
  | "after-text"
  | "background"
  | "shadow"
  | "auto-table-column"
  | "scrolled-overflow"
  | "h-scroller"
  | "beside-text-width"
  | "slider-thumb";

export type ElementMatch =
  | { readonly by: "selector"; readonly selector: string }
  | { readonly by: "token"; readonly token: string }
  | { readonly by: "fact"; readonly fact: BoxFact };

export interface Exception {
  readonly name: string;
  readonly match: ElementMatch;
  readonly reason: string;
}

interface RuleSpec {
  readonly says: string;
  readonly exceptions: readonly Exception[];
}

const COMPOSER_EDITOR = '[role="combobox"][aria-label="Message"]';

const composerEditor: Exception = {
  name: "composer-editor",
  match: { by: "selector", selector: COMPOSER_EDITOR },
  reason: "The message editor grows with what is typed in it.",
};

const scriptLength: Exception = {
  name: "script-length",
  match: { by: "fact", fact: "script-length" },
  reason:
    "A length a script writes into the style attribute, such as the transcript's virtual spacers, follows content.",
};

const centred: Exception = {
  name: "centred",
  match: { by: "fact", fact: "centred" },
  reason:
    "A box or text centred in its parent sits where its own width puts it; the parent's edges carry the grid.",
};

const endAligned: Exception = {
  name: "end-aligned",
  match: { by: "fact", fact: "end-aligned" },
  reason:
    "A box or text pushed to its parent's end starts where its own width puts it; its end edge is still checked.",
};

export const GRID_RULES = {
  spacing: {
    says: "Padding, margin, gap and inset are steps of the spacing scale; an inset may also be any even length.",
    exceptions: [
      {
        name: "line-centring",
        match: { by: "fact", fact: "line-centring" },
        reason: "An odd block padding that centres one line in its row: (row - line) / 2.",
      },
      {
        name: "traffic-lights",
        match: { by: "token", token: "--nyte-titlebar-traffic-light-inset" },
        reason: "The inset clears macOS's traffic lights, a size the window sets, not the scale.",
      },
      {
        name: "rail-inset",
        match: { by: "fact", fact: "rail-inset" },
        reason:
          "An inline padding or margin that puts content on one of its region's rails: the rail's offset minus the box's own. Cursor insets its group labels 9px this way.",
      },
      scriptLength,
    ],
  },
  "box-grid": {
    says: "A painted box and a box with a declared length are a whole number of 2px steps; controls and bars have their own sets.",
    exceptions: [
      {
        name: "hairline",
        match: { by: "fact", fact: "hairline" },
        reason: "A 1px rule is a stroke, not a box.",
      },
      {
        name: "window-edge",
        match: { by: "fact", fact: "window-edge" },
        reason: "A box that reaches the window's edge takes its size from the window.",
      },
      {
        name: "inline-run",
        match: { by: "fact", fact: "inline-run" },
        reason: "An inline box is as tall as its font's content area, which the font sets.",
      },
      composerEditor,
      scriptLength,
    ],
  },
  "control-size": {
    says: `A control is ${spell(SCALE.controls)} tall; an icon-only control is as wide as it is tall. A control is measured at its outermost painted box: a control that paints no edge or fill of its own and fills the height inside a painted box that wraps no other control is measured as that box, as an input is as its input group. A button that is a list or header row, because it carries or sits directly in role row, listitem, treeitem or option or a region's declared row, and that fills that row's height and is the widest of its controls, is measured as a row; the row is at least as tall as the row scale's first step and holds more than one control, ${spell([...SCALE.rows, ...SCALE.bars])} tall.`,
    exceptions: [
      composerEditor,
      {
        name: "switch-track",
        match: { by: "selector", selector: '[role="switch"]' },
        reason:
          "A switch is a 30×18 track, as Cursor's settings switch (.solid-switch) is; it isn't sized like a button.",
      },
      {
        name: "slider-thumb",
        match: { by: "selector", selector: '[data-slot="slider-thumb"]' },
        reason:
          "A slider's thumb is a 14px knob inside the slider, not a control of its own: its hit target is the 24px target on its ::before, and the slider is the control.",
      },
      {
        name: "multi-line",
        match: { by: "fact", fact: "multi-line" },
        reason:
          "A control that holds more than one line of text is a card; its lines set its height.",
      },
    ],
  },
  "bar-size": {
    says: `The titlebar and every pane header are the chrome bar, ${String(SCALE.chromeBar)}px.`,
    exceptions: [],
  },
  radius: {
    says: `Corner radii are ${spell(SCALE.radii)}, the last a pill.`,
    exceptions: [
      {
        name: "circle",
        match: { by: "fact", fact: "circle" },
        reason: "A percentage radius draws a circle at any size.",
      },
    ],
  },
  "icon-size": {
    says: `An icon is ${spell(SCALE.icons)} square.`,
    exceptions: [],
  },
  "type-pair": {
    says: `Text comes as a size and line-height pair: ${spell(pairs(SCALE.type), "")}, and code ${spell(pairs(SCALE.code), "")}.`,
    exceptions: [],
  },
  "half-pixel": {
    says: "Painted box edges and icons sit on whole CSS pixels.",
    exceptions: [
      centred,
      endAligned,
      {
        name: "baseline-inline",
        match: { by: "fact", fact: "inline-run" },
        reason:
          "An inline box in a line of text sits where the text puts it. On y the line's baseline does: in 15/24 Inter it is at 17.5px, so painted inline code lands on a half pixel at every type pair. On x, only when the run follows text on its line, glyph advances do. A run that starts its line is still checked on x.",
      },
      {
        name: "slider-position",
        match: { by: "fact", fact: "slider-thumb" },
        reason:
          "A slider's thumb sits at its value's share of the track, so its x is the value, not a length a token sets. On x only.",
      },
      {
        name: "text-width-row",
        match: { by: "fact", fact: "beside-text-width" },
        reason:
          "An item in a flex row whose siblings take their width from their text (a dialog's Cancel beside Save, a tab after other tabs, a chip after a chip) sits where those text widths put it, and text has fractional advances. No token sizes a word. On x only.",
      },
      {
        name: "auto-table-columns",
        match: { by: "fact", fact: "auto-table-column" },
        reason:
          "An auto-layout table sizes its columns from their content and spreads the spare width by proportion, so cell edges land on fractional x. Tested in Electron's Chromium 156: calc-size(max-content, round(up, size, 1px)) on the cells is ignored; columns only land on whole pixels with an inline-block wrapper inside each cell and the leading columns shrunk to it, a markup change that also stops those cells wrapping. On x only.",
      },
    ],
  },
  rail: {
    says: "A painted edge, an icon or a text start within 4px of one of its region's rails sits on it. Text in a box with a painted background isn't checked: the box's edge is, and the text's inset is the box's own padding.",
    exceptions: [
      centred,
      endAligned,
      {
        name: "scrolled-overflow",
        match: { by: "fact", fact: "scrolled-overflow" },
        reason:
          "Everything inside a horizontally scrolling container, its table box included, is scrolled content: the region's end rail belongs to the column, not to what scrolls inside it. Start rails still apply.",
      },
      {
        name: "ragged-end",
        match: { by: "fact", fact: "after-text" },
        reason:
          "An inline run that follows text on its line ends where the glyphs before it put it, as ragged text does, so it is exempt from the end rail. Ending past the region's end edge is overflow: that is a violation against the nearest end rail however far off it is.",
      },
    ],
  },
  rhythm: {
    says: "Rows in a list step by the region's pitch, and each row centres its first line box.",
    exceptions: [],
  },
  align: {
    says: "Rows that face each other across regions share a baseline, and stacked regions share an edge.",
    exceptions: [],
  },
  "end-in-view": {
    says: "Each chat pane shows its transcript's last row without scrolling: the row is rendered and ends inside the viewport, above the composer.",
    exceptions: [],
  },
} satisfies Record<RuleId, RuleSpec>;

/** Where a chat pane's transcript, its virtual rows and its composer are, for the end-in-view rule. */
export const TRANSCRIPT_END = {
  pane: 'section[aria-label="Active chat pane"], section[aria-label="chat pane"]',
  viewport: '[role="region"][aria-label="Messages"]',
  row: "[data-index]",
  dock: 'form[aria-label="Message"]',
} as const;

/** A length built from StyleX handles, resolved by the renderer so it follows the tokens. */
export type Expr =
  | { readonly op: "handle"; readonly handle: string }
  | { readonly op: "px"; readonly px: number }
  | { readonly op: "sum"; readonly terms: readonly Expr[] }
  | { readonly op: "diff"; readonly left: Expr; readonly right: Expr }
  | { readonly op: "half"; readonly of: Expr };

/** The handles an expression reads, which a rail's own declarations may use without being its cause. */
export function termsIn(expr: Expr): string[] {
  switch (expr.op) {
    case "handle":
      return [expr.handle];
    case "px":
      return [];
    case "sum":
      return expr.terms.flatMap(termsIn);
    case "diff":
      return [...termsIn(expr.left), ...termsIn(expr.right)];
    case "half":
      return termsIn(expr.of);
    default: {
      const exhaustive: never = expr;

      return exhaustive;
    }
  }
}

export const handle = (name: string): Expr => ({ op: "handle", handle: name });

export const px = (value: number): Expr => ({ op: "px", px: value });

export const sum = (...terms: readonly Expr[]): Expr => ({ op: "sum", terms });

export const diff = (left: Expr, right: Expr): Expr => ({ op: "diff", left, right });

export const half = (of: Expr): Expr => ({ op: "half", of });

export type RegionName =
  | "titlebar"
  | "tab-strip"
  | "sidebar"
  | "conversation"
  | "composer"
  | "composer-new-chat"
  | "workbench-rail"
  | "settings-nav"
  | "settings-page"
  | "dialog"
  | "editor"
  | "changes";

/** Where a region's box is: a selector, or the element inside `within` whose width reads `token`. */
export type Locate =
  | { readonly by: "selector"; readonly selector: string }
  | { readonly by: "token"; readonly within: string; readonly token: string };

export interface Rail {
  readonly name: string;
  readonly from: "start" | "end";
  readonly offset: Expr;
  readonly why: string;
}

export interface Rhythm {
  readonly rows: string;
  /** Null when the rows have no fixed pitch, as file headers with diffs between them don't. */
  readonly pitch: Expr | null;
  readonly why: string;
}

export interface RegionSpec {
  readonly name: RegionName;
  readonly locate: Locate;
  readonly rails: readonly Rail[];
  readonly rhythm: Rhythm | null;
  /** Boxes that sit centred on the region's height, such as a bar's controls. */
  readonly centred: string | null;
}

const sidebarRowStart = sum(handle("sidebar.gutter"), handle("sidebar.rowPaddingInline"));

const railRowStart = sum(handle("space.s2"), handle("workbench.rowPaddingInline"));

export const REGIONS: readonly RegionSpec[] = [
  {
    name: "titlebar",
    locate: { by: "selector", selector: "[data-nyte-shell] header" },
    rails: [
      {
        name: "traffic-lights",
        from: "start",
        offset: handle("shell.trafficLightInset"),
        why: "The first control clears the window's traffic lights.",
      },
    ],
    rhythm: null,
    centred: "button",
  },
  {
    name: "tab-strip",
    locate: { by: "selector", selector: '[role="tablist"][aria-label="Tabs"]' },
    rails: [],
    rhythm: null,
    centred: '[role="tab"]',
  },
  {
    name: "sidebar",
    locate: { by: "selector", selector: 'aside:has(> nav[aria-label="Sessions and workspaces"])' },
    rails: [
      {
        name: "row-edge",
        from: "start",
        offset: handle("sidebar.gutter"),
        why: "Rows and section headers start at the gutter.",
      },
      {
        name: "glyph",
        from: "start",
        offset: sum(sidebarRowStart, half(diff(handle("sidebar.iconSlot"), handle("glyph.sm")))),
        why: "Icons sit centred in the icon slot; header text starts where the icons do.",
      },
      {
        name: "label",
        from: "start",
        offset: sum(sidebarRowStart, handle("sidebar.iconSlot"), handle("sidebar.rowGap")),
        why: "Row labels start after the icon slot and the row gap.",
      },
      {
        name: "row-end",
        from: "end",
        offset: handle("sidebar.gutter"),
        why: "Rows end at the gutter.",
      },
    ],
    rhythm: {
      rows: '[data-slot="row"]',
      pitch: sum(handle("sidebar.rowHeight"), handle("sidebar.listGap")),
      why: "A list steps by the row height and the list gap.",
    },
    centred: null,
  },
  {
    name: "conversation",
    locate: {
      by: "token",
      within: '[role="region"][aria-label="Messages"]',
      token: "--nyte-conversation-measure",
    },
    rails: [
      {
        name: "content",
        from: "start",
        offset: handle("conversation.gutter"),
        why: "Prose, tables and blocks start at the gutter inside the measure.",
      },
      {
        name: "content-end",
        from: "end",
        offset: handle("conversation.gutter"),
        why: "Wide blocks and the user's bubble end at the gutter.",
      },
    ],
    rhythm: null,
    centred: null,
  },
  {
    name: "composer",
    locate: { by: "selector", selector: 'form[data-composer-frame="follow-up"]' },
    rails: [
      {
        name: "controls",
        from: "start",
        offset: sum(px(1), handle("space.s2_5")),
        why: "The first control sits inside the frame's border and padding.",
      },
      {
        name: "controls-end",
        from: "end",
        offset: sum(px(1), handle("space.s2")),
        why: "The send button sits inside the frame's border and end padding.",
      },
    ],
    rhythm: null,
    centred: null,
  },
  {
    name: "composer-new-chat",
    locate: { by: "selector", selector: 'form[data-composer-frame="new-chat"]' },
    rails: [
      {
        name: "controls",
        from: "start",
        offset: sum(px(1), handle("space.s3")),
        why: "The new chat's composer is the larger frame: its controls sit inside its border and 12px padding.",
      },
      {
        name: "controls-end",
        from: "end",
        offset: sum(px(1), handle("space.s3")),
        why: "The send button sits inside the frame's border and 12px end padding.",
      },
    ],
    rhythm: null,
    centred: null,
  },
  {
    name: "workbench-rail",
    locate: { by: "selector", selector: 'nav[aria-label="Workbench navigation"]' },
    rails: [
      {
        name: "row-edge",
        from: "start",
        offset: handle("space.s2"),
        why: "Rows start at the rail's inline padding.",
      },
      {
        name: "glyph",
        from: "start",
        offset: sum(railRowStart, half(diff(handle("glyph.md"), handle("glyph.sm")))),
        why: "Icons sit centred in the leading slot; heading text starts where the icons do.",
      },
      {
        name: "label",
        from: "start",
        offset: sum(railRowStart, handle("glyph.md"), handle("workbench.rowGap")),
        why: "Row labels start after the leading slot and the row gap.",
      },
      {
        name: "row-end",
        from: "end",
        offset: handle("space.s2"),
        why: "Rows end at the rail's inline padding.",
      },
      {
        name: "actions-end",
        from: "end",
        offset: railRowStart,
        why: "Row actions end at the row's inline padding.",
      },
    ],
    rhythm: {
      rows: '[data-slot="row"]',
      pitch: sum(handle("row.heightMd"), handle("target.gap")),
      why: "A rail section steps by the row height and the target gap.",
    },
    centred: null,
  },
  {
    name: "settings-nav",
    locate: { by: "selector", selector: 'nav[aria-label="Settings"]' },
    rails: [],
    rhythm: null,
    centred: null,
  },
  {
    name: "settings-page",
    locate: { by: "token", within: "main", token: "--nyte-settings-content-width" },
    rails: [],
    rhythm: null,
    centred: null,
  },
  {
    name: "editor",
    locate: {
      by: "selector",
      selector: '[data-slot="markdown-column"]',
    },
    rails: [
      {
        name: "content",
        from: "start",
        offset: handle("space.s6"),
        why: "The workbench markdown editor's text, tables and blocks start at the column's padding.",
      },
      {
        name: "content-end",
        from: "end",
        offset: handle("space.s6"),
        why: "Wide blocks end at the column's end padding.",
      },
    ],
    rhythm: null,
    centred: null,
  },
  {
    name: "changes",
    locate: { by: "selector", selector: '[data-slot="changes-panel"]' },
    rails: [
      {
        name: "content",
        from: "start",
        offset: handle("space.s2"),
        why: "The commit form and the panel's content start at its 8px padding.",
      },
      {
        name: "content-end",
        from: "end",
        offset: handle("space.s2"),
        why: "They end at the same padding.",
      },
    ],
    rhythm: {
      rows: '[data-slot="change-header"]',
      pitch: null,
      why: "Each changed file's header is the list's row; its diff sits between headers, so there is no fixed pitch.",
    },
    centred: null,
  },
  {
    name: "dialog",
    locate: { by: "selector", selector: '[role="dialog"]' },
    rails: [
      {
        name: "padding",
        from: "start",
        offset: handle("dialog.padding"),
        why: "Dialog content starts at the dialog's padding.",
      },
      {
        name: "padding-end",
        from: "end",
        offset: handle("dialog.padding"),
        why: "Dialog content ends at the dialog's padding.",
      },
    ],
    rhythm: null,
    centred: null,
  },
];

/** A box or line that faces another one across regions. */
export type Pick =
  | { readonly kind: "first-row"; readonly region: RegionName }
  | {
      readonly kind: "box";
      readonly name: string;
      readonly selector: string;
      /** Keep only matches in a chat pane whose bottom is on the window's bottom edge; each one is compared. */
      readonly within?: "bottom-edge-pane";
      /** On the y axis, the box's first text baseline (the default) or its bottom edge. */
      readonly line?: "baseline" | "end";
    }
  | { readonly kind: "rail"; readonly region: RegionName; readonly rail: string };

export interface Alignment {
  readonly name: string;
  readonly axis: "x" | "y";
  readonly a: Pick;
  readonly b: Pick;
  readonly why: string;
}

export const ALIGNMENTS: readonly Alignment[] = [
  {
    name: "first-rows",
    axis: "y",
    a: { kind: "first-row", region: "sidebar" },
    b: { kind: "first-row", region: "workbench-rail" },
    why: "The sidebar's first row and the workbench rail's first row read as one line.",
  },
  {
    name: "composer-on-content",
    axis: "x",
    a: { kind: "box", name: "the composer frame", selector: 'form[aria-label="Message"]' },
    b: { kind: "rail", region: "conversation", rail: "content" },
    why: "The composer frame starts on the transcript's content edge.",
  },
  {
    name: "footers",
    axis: "y",
    a: {
      kind: "box",
      name: "the sidebar footer row",
      selector: 'aside:has(> nav[aria-label="Sessions and workspaces"]) > div:last-child > div',
      line: "end",
    },
    b: {
      kind: "box",
      name: "the composer footer",
      selector: 'form[aria-label="Message"] ~ div',
      within: "bottom-edge-pane",
      line: "end",
    },
    why: "The sidebar footer row and the composer footer close the window on one line: their bottom edges meet. Their text is 13px and 12px, whose baselines can't both sit on whole pixels and match.",
  },
];
