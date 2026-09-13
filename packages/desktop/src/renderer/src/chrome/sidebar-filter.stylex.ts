import * as stylex from "@stylexjs/stylex";
import { sidebar } from "../theme/schema.stylex.ts";
import { t } from "../theme/vars.stylex.ts";

export const sidebarFilterStyles = stylex.create({
  controls: { display: "inline-flex", alignItems: "center", gap: 2, flexShrink: 0 },
  action: {
    "--_action-fill": { default: "transparent", ":hover": t.fillGhostHover },
    display: "grid",
    placeItems: "center",
    width: sidebar.actionSize,
    height: sidebar.actionSize,
    padding: 0,
    borderStyle: "none",
    borderRadius: t.radiusBase,
    backgroundColor: "var(--_action-fill)",
    color: t.iconTertiary,
    cursor: { default: "pointer", ":disabled": "default" },
    opacity: { default: 1, ":disabled": 0.45 },
    lineHeight: 0,
  },
  /* One fill per state: hover has nothing to add to a filter already on. */
  actionActive: { "--_action-fill": t.fillAccentSubtle, color: t.textAccent },
  popup: {
    width: "min(220px, var(--available-width))",
    minWidth: 0,
    maxWidth: "var(--available-width)",
  },
});
