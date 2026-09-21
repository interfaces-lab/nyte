import type { DialConfig } from "dialkit";
import type { Appearance, BackdropKind, TokenSet } from "./chrome";

const defaults = {
  expanded: true,
  animate: true,
  scrub: false,
  override: false,
  columns: true,
  rows: true,
};

/*
 * Every switch the lab has. The rig used to carry its own strip of buttons
 * along the foot of the stage, which meant two control surfaces to learn and a
 * band of chrome across the thing being audited. DialKit already owns
 * collapsing, persistence and keyboard entry, so the scene selects live here
 * beside the sliders that were always in the panel.
 */
export const previewConfig = {
  appearance: {
    type: "select",
    options: [
      { value: "light", label: "Light" },
      { value: "dark", label: "Dark" },
    ],
    default: "dark",
  },
  tokens: {
    type: "select",
    options: [
      { value: "nyte", label: "A · Desktop" },
      { value: "calendar", label: "B · Calendar" },
    ],
    default: "nyte",
  },
  surface: {
    type: "select",
    options: [
      { value: "none", label: "None" },
      { value: "menu", label: "Menu" },
      { value: "submenu", label: "Submenu" },
      { value: "context", label: "Context menu" },
      { value: "popover", label: "Popover" },
      { value: "dialog", label: "Dialog" },
    ],
    default: "none",
  },
  workbench: {
    type: "select",
    options: [
      { value: "rail", label: "Rail" },
      { value: "compact", label: "Icon rail" },
      { value: "panel", label: "Panel" },
    ],
    default: "rail",
  },
  backdrop: {
    type: "select",
    options: [
      { value: "flat", label: "Flat" },
      { value: "grid", label: "Grid" },
      { value: "photo", label: "Photo" },
    ],
    default: "flat",
  },
  sidebar: {
    _collapsed: true,
    expanded: defaults.expanded,
    animate: defaults.animate,
    scrub: { enabled: defaults.scrub, position: [100, 0, 100, 0.1] },
    duration: { _collapsed: true, override: defaults.override, value: [150, 0, 1000, 1] },
    easing: {
      _collapsed: true,
      override: defaults.override,
      value: { type: "text", default: "cubic-bezier(0.16, 1, 0.3, 1)" },
    },
  },
  guides: {
    _collapsed: true,
    columns: defaults.columns,
    rows: defaults.rows,
    opacity: { override: defaults.override, value: [0.45, 0, 1, 0.01] },
    color: { override: defaults.override, value: { type: "color", default: "#409bff" } },
  },
} satisfies DialConfig;

export function appearanceOf(value: string): Appearance {
  return value === "light" ? "light" : "dark";
}

export function tokenSetOf(value: string): TokenSet {
  return value === "calendar" ? "calendar" : "nyte";
}

export function backdropOf(value: string): BackdropKind {
  return value === "photo" || value === "grid" ? value : "flat";
}
