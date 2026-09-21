import type { ColorConfig, DialConfig, TextConfig } from "dialkit";
import calendarCss from "../tokens/calendar.css?raw";
import type { Appearance, TokenSet } from "./chrome";

export const lengths = [
  ["--nyte-titlebar-height", "Titlebar height"],
  ["--nyte-sidebar-row-height", "Sidebar row height"],
  ["--nyte-sidebar-row-gap", "Sidebar row gap"],
  ["--nyte-sidebar-row-padding-inline", "Sidebar row padding"],
  ["--nyte-sidebar-section-gap", "Sidebar section gap"],
  ["--nyte-conversation-measure", "Conversation width"],
  ["--nyte-conversation-gutter", "Conversation gutter"],
  ["--nyte-conversation-turn-gap", "Turn gap"],
  ["--nyte-prose-paragraph-gap", "Paragraph gap"],
  ["--nyte-workbench-rail-width", "Workbench width"],
  ["--nyte-workbench-row-height", "Workbench row height"],
  ["--nyte-workbench-row-gap", "Workbench row gap"],
  ["--nyte-workbench-row-padding-inline", "Workbench row padding"],
  ["--nyte-workbench-rail-gap", "Workbench section gap"],
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
  ["--nyte-radius-xl", "Message / popover radius"],
  ["--nyte-dialog-width", "Dialog width"],
  ["--nyte-dialog-padding", "Dialog padding"],
  ["--nyte-dialog-gap", "Dialog gap"],
  ["--nyte-dialog-radius", "Dialog radius"],
  ["--nyte-suggestion-padding", "Popover padding"],
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
  ["--nyte-stroke-primary", "Strong borders"],
  ["--nyte-bg-tertiary", "Hover fill"],
  ["--nyte-bg-quaternary", "Selected fill"],
  ["--nyte-conversation-user-shell-background", "Message shell fill"],
  ["--nyte-conversation-user-background", "Message fill"],
  ["--nyte-conversation-user-ring", "Message border"],
  ["--nyte-stroke-secondary", "Borders"],
  ["--nyte-text-success", "Added lines"],
  ["--nyte-text-danger", "Removed lines"],
] as const;

export const strings = [
  ["--nyte-font-family-sans", "font-family"],
  ["--nyte-shadow-popover", "box-shadow"],
  ["--nyte-shadow-modal", "box-shadow"],
] as const;
export const opacityToken = "--nyte-sidebar-material-opacity";
const calendarNames = new Set(
  Array.from(calendarCss.matchAll(/(--nyte-[\w-]+)\s*:/g), (match) => match[1]),
);
const tokenNames: string[] = [
  ...[...lengths, ...colors, ...strings].map(([name]) => name),
  opacityToken,
];

export type TokenBaseline = Record<string, string | number>;
export type TokenBaselines = Record<TokenSet, TokenBaseline>;

type NumberControl = {
  _collapsed: boolean;
  override: boolean;
  value: [number, number, number, number];
};
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
  const result: TokenBaselines = { nyte: {}, calendar: {} };
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
        result[set][name] = value;
      }
      result[set][opacityToken] = parseFloat(computed.getPropertyValue(opacityToken));
      for (const [name] of colors) {
        probe.style.color = `var(${name})`;
        result[set][name] = pickerColor(view.getComputedStyle(probe).color);
      }
      for (const [name] of strings) result[set][name] = computed.getPropertyValue(name).trim();
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
  const typographyAndShadows: Record<string, StringControl> = {};
  for (const [name] of lengths) {
    const value = baseline[name];
    if (typeof value !== "number") continue;
    const max = /measure|dialog-width/.test(name)
      ? 1600
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
    const value = baseline[name];
    if (typeof value !== "string") continue;
    palette[name] = {
      _collapsed: true,
      override: set === "calendar" && calendarNames.has(name),
      value: { type: "color", default: value },
    };
  }
  for (const [name] of strings) {
    const value = baseline[name];
    if (typeof value !== "string") continue;
    typographyAndShadows[name] = {
      _collapsed: true,
      override: set === "calendar" && calendarNames.has(name),
      value: { type: "text", default: value },
    };
  }
  const opacity = baseline[opacityToken];
  const material: Record<string, NumberControl> = {
    [opacityToken]: {
      _collapsed: true,
      override: set === "calendar",
      value: [typeof opacity === "number" ? opacity : 100, 0, 100, 0.1],
    },
  };
  return {
    geometry,
    palette,
    typographyAndShadows,
    material,
    disableAll: { type: "action", label: "Disable all overrides" },
    reset: { type: "action", label: "Reset this profile" },
  } satisfies DialConfig;
}
