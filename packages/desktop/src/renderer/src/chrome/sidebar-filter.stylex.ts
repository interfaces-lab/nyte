import * as stylex from "@stylexjs/stylex";
import { sidebar } from "../theme/schema.stylex.ts";
import { t } from "../theme/vars.stylex.ts";

export const sidebarFilterStyles = stylex.create({
  controls: { display: "inline-flex", alignItems: "center", gap: 2, flexShrink: 0 },
  action: {
    display: "grid",
    placeItems: "center",
    width: sidebar.actionSize,
    height: sidebar.actionSize,
    padding: 0,
    borderStyle: "none",
    borderRadius: t.radiusBase,
    backgroundColor: { default: "transparent", ":hover": t.fillSecondaryHover },
    color: t.iconTertiary,
    cursor: { default: "pointer", ":disabled": "default" },
    opacity: { default: 1, ":disabled": 0.45 },
  },
  actionActive: { backgroundColor: t.fillAccentSubtle, color: t.textAccent },
  popup: {
    width: "min(220px, var(--available-width))",
    minWidth: 0,
    maxWidth: "var(--available-width)",
  },
});
