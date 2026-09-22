import type { ColorConfig, DialConfig, TextConfig } from "dialkit";
import calendarCss from "../tokens/calendar.css?raw";
import type { Appearance, TokenSet } from "./chrome";

export const lengths = [
  ["--nyte-titlebar-height", "Titlebar height"],
  ["--nyte-glyph-box", "Status glyph box"],
  ["--nyte-sidebar-row-height", "Sidebar row height"],
  ["--nyte-sidebar-row-gap", "Sidebar row gap"],
  ["--nyte-sidebar-row-padding-inline", "Sidebar row padding"],
  ["--nyte-sidebar-section-gap", "Sidebar section gap"],
  ["--nyte-conversation-measure", "Conversation width"],
  ["--nyte-conversation-gutter", "Conversation gutter"],
  ["--nyte-conversation-turn-gap", "Turn gap"],
  ["--nyte-prose-paragraph-gap", "Paragraph gap"],
  ["--nyte-workbench-rail-width", "Workbench rail width"],
  ["--nyte-workbench-row-height", "Workbench row height"],
  ["--nyte-workbench-row-gap", "Workbench row gap"],
  ["--nyte-workbench-row-padding-inline", "Workbench row padding"],
  ["--nyte-workbench-rail-gap", "Workbench section gap"],
  ["--nyte-workbench-heading-height", "Workbench heading height"],
  ["--nyte-workbench-panel-width", "Workbench panel width"],
  ["--nyte-workbench-header-height", "Workbench header height"],
  ["--nyte-workbench-file-list-width", "Changes file list width"],
  ["--nyte-pane-sash-size", "Pane sash size"],
  ["--nyte-diff-line-height", "Diff line height"],
  ["--nyte-font-size-base", "UI font size"],
  ["--nyte-font-size-lg", "Conversation font size"],
  ["--nyte-line-height-lg", "Conversation line height"],
  ["--nyte-line-height-base", "UI line height"],
  ["--nyte-sidebar-gutter", "Sidebar gutter"],
  ["--nyte-sidebar-icon-slot", "Sidebar icon lane"],
  ["--nyte-sidebar-list-gap", "Sidebar list gap"],
  ["--nyte-sidebar-meta-width", "Sidebar timestamp lane"],
  ["--nyte-sidebar-trailing-width", "Sidebar action lane"],
  ["--nyte-radius-base", "Row radius"],
  ["--nyte-radius-lg", "Menu row radius source"],
  ["--nyte-radius-xl", "Message / popover radius"],
  ["--nyte-radius-2xl", "Menu radius source"],
  ["--nyte-dialog-width", "Dialog width"],
  ["--nyte-dialog-padding", "Dialog padding"],
  ["--nyte-dialog-gap", "Dialog gap"],
  ["--nyte-dialog-radius", "Dialog radius"],
  ["--nyte-suggestion-item-height", "Popover row minimum"],
  ["--nyte-suggestion-item-gap", "Popover column gap"],
  ["--nyte-menu-width", "Menu width"],
  ["--nyte-menu-padding", "Menu padding"],
  ["--nyte-menu-radius", "Menu radius"],
  ["--nyte-menu-item-radius", "Menu row radius"],
  ["--nyte-menu-item-height", "Menu row minimum"],
  ["--nyte-menu-item-gap", "Menu column gap"],
  ["--nyte-menu-item-padding-inline", "Menu row inline padding"],
  ["--nyte-menu-item-padding-block", "Menu row block padding"],
  ["--nyte-menu-max-height", "Menu maximum height"],
  ["--nyte-model-menu-width", "Model menu width"],
  ["--nyte-parameter-menu-width", "Parameter menu width"],
] as const;

export const colors = [
  ["--nyte-base", "Palette ink"],
  ["--nyte-chrome-base", "Window color"],
  ["--nyte-editor-base", "Editor color"],
  ["--nyte-bg-raised", "Raised surface color"],
  ["--lab-window-backing", "Simulated window backing"],
  ["--nyte-sidebar-base", "Sidebar color"],
  ["--nyte-text-primary", "Primary text"],
  ["--nyte-text-secondary", "Secondary text"],
  ["--nyte-text-tertiary", "Tertiary text"],
  ["--nyte-icon-primary", "Primary icons"],
  ["--nyte-icon-secondary", "Icons"],
  ["--nyte-icon-tertiary", "Tertiary icons"],
  ["--nyte-text-quaternary", "Disabled text"],
  ["--nyte-stroke-primary", "Strong borders"],
  ["--nyte-stroke-tertiary", "Faint borders"],
  ["--nyte-stroke-quaternary", "Hairlines"],
  ["--nyte-bg-tertiary", "Hover fill"],
  ["--nyte-bg-quaternary", "Selected fill"],
  ["--nyte-bg-scrim", "Dialog scrim"],
  ["--nyte-conversation-user-shell-background", "Message shell fill"],
  ["--nyte-conversation-user-background", "Message fill"],
  ["--nyte-conversation-user-ring", "Message border"],
  ["--nyte-stroke-secondary", "Borders"],
  ["--nyte-text-success", "Added lines"],
  ["--nyte-text-danger", "Removed lines"],
  ["--nyte-diff-added-line-background", "Added line fill"],
  ["--nyte-diff-removed-line-background", "Removed line fill"],
] as const;

export const strings = [["--nyte-font-family-sans", "font-family"]] as const;

/*
 * Shadows get their own group because colour and depth are separate
 * decisions. The ink drives every cast shadow through the secondary and
 * tertiary mixes in tokens.css; the depth multiplier drives every offset and
 * blur through src/tokens/shadow.css. The three composites below stay
 * available for pasting a stack wholesale, and override an earlier dial when
 * they are on.
 */
export const shadowColors = [["--nyte-shadow-primary", "Shadow ink"]] as const;

export const shadowScales = [["--lab-shadow-depth", "Shadow depth"]] as const;

export const shadowStrings = [
  ["--nyte-shadow-popover", "box-shadow"],
  ["--nyte-shadow-modal", "box-shadow"],
  ["--nyte-shadow-workbench", "box-shadow"],
] as const;

export const opacityToken = "--nyte-sidebar-material-opacity";

const calendarNames = new Set(
  Array.from(calendarCss.matchAll(/(--nyte-[\w-]+)\s*:/g), (match) => match[1]),
);

const tokenNames: string[] = [
  ...[...lengths, ...colors, ...strings, ...shadowColors, ...shadowScales, ...shadowStrings].map(
    ([name]) => name,
  ),
  opacityToken,
];

export interface TokenBaseline {
  readonly numbers: Map<string, number>;
  readonly texts: Map<string, string>;
}

export type TokenBaselines = Record<TokenSet, TokenBaseline>;

type NumberControl = {
  _collapsed: boolean;
  override: boolean;
  value: [number, number, number, number];
};

type ScaleControl = [number, number, number, number];

type ColorControl = { _collapsed: boolean; override: boolean; value: ColorConfig };

type StringControl = { _collapsed: boolean; override: boolean; value: TextConfig };

function pickerColor(value: string): string {
  const match =
    /^color\(srgb\s+([\d.e+-]+)\s+([\d.e+-]+)\s+([\d.e+-]+)(?:\s*\/\s*([\d.e+-]+))?\)$/.exec(value);

  if (match === null) return value;
  const [, red, green, blue, alpha] = match;

  if (red === undefined || green === undefined || blue === undefined) return value;

  return `rgb(${Number(red) * 255} ${Number(green) * 255} ${Number(blue) * 255} / ${alpha ?? "1"})`;
}

export function readTokenBaselines(preview: Document, appearance: Appearance): TokenBaselines {
  const view = preview.defaultView;

  if (view === null) throw new Error("Preview has no window");
  const root = preview.documentElement;

  const attributes = ["data-theme", "data-appearance", "data-lab-reference"].map((name) => ({
    name,
    value: root.getAttribute(name),
  }));

  const inline = tokenNames.map((name) => ({
    name,
    value: root.style.getPropertyValue(name),
    priority: root.style.getPropertyPriority(name),
  }));

  const probe = preview.createElement("i");
  probe.style.cssText =
    "position:absolute;visibility:hidden;pointer-events:none;display:block;height:0";

  const result: TokenBaselines = {
    nyte: { numbers: new Map(), texts: new Map() },
    calendar: { numbers: new Map(), texts: new Map() },
  };

  preview.body.append(probe);

  try {
    for (const { name } of inline) root.style.removeProperty(name);
    root.setAttribute("data-theme", appearance);
    root.setAttribute("data-appearance", appearance);

    for (const set of ["nyte", "calendar"] as const) {
      root.setAttribute("data-lab-reference", set);
      const computed = view.getComputedStyle(root);

      for (const [name] of lengths) {
        probe.style.width = `var(${name})`;
        const value = parseFloat(view.getComputedStyle(probe).width);

        if (!Number.isFinite(value)) throw new Error(`Cannot resolve ${name}`);
        result[set].numbers.set(name, value);
      }

      result[set].numbers.set(opacityToken, parseFloat(computed.getPropertyValue(opacityToken)));

      for (const [name] of shadowScales) {
        const value = parseFloat(computed.getPropertyValue(name));
        result[set].numbers.set(name, Number.isFinite(value) ? value : 1);
      }

      for (const [name] of [...colors, ...shadowColors]) {
        probe.style.color = `var(${name})`;
        result[set].texts.set(name, pickerColor(view.getComputedStyle(probe).color));
      }

      for (const [name] of [...strings, ...shadowStrings])
        result[set].texts.set(name, computed.getPropertyValue(name).trim());
    }
  } finally {
    probe.remove();

    for (const { name, value, priority } of inline) {
      if (value === "") root.style.removeProperty(name);
      else root.style.setProperty(name, value, priority);
    }

    for (const { name, value } of attributes) {
      if (value === null) root.removeAttribute(name);
      else root.setAttribute(name, value);
    }
  }

  return result;
}

export function tokenConfig(baseline: TokenBaseline, set: TokenSet) {
  const geometry: Record<string, NumberControl> = {};
  const palette: Record<string, ColorControl> = {};
  const typography: Record<string, StringControl> = {};
  const ink: Record<string, ColorControl> = {};
  const depth: Record<string, ScaleControl> = {};
  const stacks: Record<string, StringControl> = {};

  for (const [name] of lengths) {
    const value = baseline.numbers.get(name);

    if (value === undefined) continue;

    const max = /measure|dialog-width/.test(name)
      ? 1600
      : /max-height/.test(name)
        ? 1200
        : name.endsWith("-width")
          ? 640
          : /font-size/.test(name)
            ? 48
            : 128;

    geometry[name] = {
      _collapsed: true,
      override: set === "calendar" && calendarNames.has(name),
      value: [value, 0, max, 0.01],
    };
  }

  for (const [name] of colors) {
    const value = baseline.texts.get(name);

    if (value === undefined) continue;
    palette[name] = {
      _collapsed: true,
      override: set === "calendar" && calendarNames.has(name),
      value: { type: "color", default: value },
    };
  }

  for (const [name] of strings) {
    const value = baseline.texts.get(name);

    if (value === undefined) continue;
    typography[name] = {
      _collapsed: true,
      override: set === "calendar" && calendarNames.has(name),
      value: { type: "text", default: value },
    };
  }

  for (const [name] of shadowColors) {
    const value = baseline.texts.get(name);

    if (value === undefined) continue;
    ink[name] = {
      _collapsed: true,
      override: set === "calendar" && calendarNames.has(name),
      value: { type: "color", default: value },
    };
  }

  /* Depth has no override toggle. It rests at the shipped 1, so the slider is
   * the whole control and a second switch beside it would say nothing. */
  for (const [name] of shadowScales) {
    depth[name] = [baseline.numbers.get(name) ?? 1, 0, 4, 0.05];
  }

  for (const [name] of shadowStrings) {
    const value = baseline.texts.get(name);

    if (value === undefined) continue;
    stacks[name] = {
      _collapsed: true,
      override: set === "calendar" && calendarNames.has(name),
      value: { type: "text", default: value },
    };
  }

  const material = {
    [opacityToken]: {
      _collapsed: true,
      override: set === "calendar",
      value: [baseline.numbers.get(opacityToken) ?? 100, 0, 100, 0.1],
    },
  } satisfies Record<string, NumberControl>;

  return {
    geometry,
    palette,
    shadows: { ink, depth, stacks },
    typography,
    material,
    disableAll: { type: "action", label: "Disable all overrides" },
    reset: { type: "action", label: "Reset this profile" },
  } satisfies DialConfig;
}
