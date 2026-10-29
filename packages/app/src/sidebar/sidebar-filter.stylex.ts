import { create } from "@stylexjs/stylex";
import { space } from "@nyte-ai/ui/styles/schema.stylex";

export const sidebarFilterStyles = create({
  controls: { display: "inline-flex", alignItems: "center", gap: space.s2, flexShrink: 0 },
  popup: {
    width: "min(220px, var(--available-width))",
    minWidth: 0,
    maxWidth: "var(--available-width)",
  },
  groupHeading: { display: "flex", alignItems: "center" },
  groupLabel: { flex: 1 },
});
