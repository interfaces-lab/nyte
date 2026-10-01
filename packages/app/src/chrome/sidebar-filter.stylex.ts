import { create } from "@stylexjs/stylex";

export const sidebarFilterStyles = create({
  controls: { display: "inline-flex", alignItems: "center", gap: 2, flexShrink: 0 },
  popup: {
    width: "min(220px, var(--available-width))",
    minWidth: 0,
    maxWidth: "var(--available-width)",
  },
});
