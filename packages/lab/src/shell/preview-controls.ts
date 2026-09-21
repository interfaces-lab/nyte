import type { DialConfig } from "dialkit";

const defaults = {
  expanded: true,
  animate: true,
  scrub: false,
  override: false,
  columns: true,
  rows: true,
};

export const previewConfig = {
  sidebar: {
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
