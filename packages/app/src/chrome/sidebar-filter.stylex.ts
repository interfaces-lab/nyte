import { create } from "@stylexjs/stylex";
import { menu, shape } from "@nyte-ai/ui/schema.stylex";
import { role, type } from "@nyte-ai/ui/vars.stylex";

export const sidebarFilterStyles = create({
  controls: { display: "inline-flex", alignItems: "center", gap: 8, flexShrink: 0 },
  popup: {
    width: "min(220px, var(--available-width))",
    minWidth: 0,
    maxWidth: "var(--available-width)",
  },
  groupHeading: { display: "flex", alignItems: "center" },
  groupLabel: { flex: 1 },
  groupAction: {
    gridTemplateColumns: "auto",
    alignItems: "center",
    justifyContent: "center",
    minWidth: menu.itemHeight,
    minHeight: menu.itemHeight,
    paddingInline: 6,
    paddingBlock: 2,
    borderRadius: shape.control,
    color: {
      default: role.contentInteractiveSecondary,
      "[data-highlighted]": role.contentInteractivePrimary,
    },
    backgroundColor: { default: "transparent", "[data-highlighted]": role.bgHover },
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
  },
});
