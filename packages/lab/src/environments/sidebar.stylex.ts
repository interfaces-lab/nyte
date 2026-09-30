import { create } from "@stylexjs/stylex";
import { t } from "@nyte-ai/ui/vars.stylex";

export const railStyles = create({
  rail: { height: "100%", backgroundColor: t.sidebarMaterial },

  /**
   * 3: a machine you can't reach keeps its rows in place at half weight. The
   * content fades, not the row, so a selected row keeps a solid selection.
   */
  unreachable: { opacity: 0.5 },

  /** 5: a corner mark on the leading glyph, only for chats running elsewhere. */
  badgeHost: {
    position: "relative",
    display: "grid",
    placeItems: "center",
    width: "100%",
    height: "100%",
  },
  badge: {
    position: "absolute",
    insetInlineEnd: -4,
    insetBlockEnd: -3,
    display: "grid",
    placeItems: "center",
    width: 12,
    height: 12,
    borderRadius: t.radiusFull,
    backgroundColor: t.sidebarMaterial,
    color: t.contentSecondary,
  },
});
