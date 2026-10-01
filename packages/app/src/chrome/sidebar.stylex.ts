import { shape } from "@nyte-ai/ui/schema.stylex";
/**
 * Sidebar feature styles.
 * Based on https://github.com/interfaces-lab/honk/blob/main/packages/app/src/desktop-extensions/vertical-sidebar/view.tsx
 */
import { create } from "@stylexjs/stylex";
import { sidebar } from "../theme/schema.stylex.ts";
import { appearance, motion, role, type } from "@nyte-ai/ui/vars.stylex";

export const sidebarStyles = create({
  rail: {
    display: "flex",
    flexDirection: "column",
    width: sidebar.width,
    minWidth: 0,
    minHeight: 0,
    flexShrink: 0,
    containerType: "inline-size",
    containerName: "nyte-sidebar",
  },
  content: {
    "--_sidebar-motion-duration": motion.durationNormal,
    "--_sidebar-motion-easing": motion.easeOutQuint,
    // Archiving is a dismissal, not a rearrangement: one short slide, no glide.
    "--_sidebar-archive-duration": motion.durationFast,
    position: "relative",
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
  },
  contentLayer: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
  primaryActions: {
    display: "flex",
    flexDirection: "column",
    gap: sidebar.listGap,
    paddingInline: sidebar.gutter,
    paddingBlockStart: 6,
  },
  /**
   * A `Row` that is itself the button, shared with the settings rail. The row
   * brings the fill and colour states; this adds the rail's type and reveals
   * the shortcut with them.
   */
  navRow: {
    minHeight: sidebar.rowHeight,
    gap: sidebar.rowGap,
    "--_row-padding-inline": sidebar.rowPaddingInline,
    "--_shortcut-opacity": {
      default: "0",
      ":hover": { "@media (hover: hover) and (pointer: fine)": "1" },
      ":focus-visible": "1",
    },
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    fontWeight: 400,
  },
  navLeading: { width: sidebar.iconSlot },
  navRowActive: { "--_shortcut-opacity": "1" },
  shortcutSlot: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    minWidth: sidebar.trailingWidth,
    flexShrink: 0,
    opacity: "var(--_shortcut-opacity)",
    transitionProperty: "opacity",
    transitionDuration: motion.durationFast,
    transitionTimingFunction: motion.easeOut,
  },
  shortcutPersistent: { opacity: 1 },
  scroll: {
    position: "relative",
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: sidebar.sectionGap,
    paddingInline: sidebar.gutter,
    paddingBlockStart: sidebar.gutter,
    paddingBlockEnd: sidebar.gutter,
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: sidebar.listGap,
    minWidth: 0,
  },
  sectionHeader: {
    "--_section-chevron-opacity": {
      default: "0",
      ":hover": { "@media (hover: hover) and (pointer: fine)": "1" },
      ":focus-within": "1",
    },
    display: "flex",
    alignItems: "center",
    gap: 4,
    width: "100%",
    height: sidebar.rowHeight,
    paddingInlineEnd: sidebar.rowPaddingInline,
    color: role.contentSecondary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    fontWeight: 400,
    flexShrink: 0,
  },
  sectionToggle: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
    height: "100%",
    paddingInlineStart: sidebar.rowPaddingInline,
    paddingInlineEnd: 4,
    flex: 1,
    borderRadius: shape.control,
    color: "inherit",
  },
  sectionChevron: {
    opacity: "var(--_section-chevron-opacity)",
    transitionTimingFunction: motion.easeOut,
  },
  sectionLabel: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  workspaceCollection: {
    display: { default: "flex", "[hidden]": "none" },
    flexDirection: "column",
    gap: sidebar.listGap,
    minWidth: 0,
  },
  rowSurface: {
    minHeight: sidebar.rowHeight,
    gap: sidebar.rowGap,
    "--_row-padding-inline": sidebar.rowPaddingInline,
    borderRadius: shape.control,
    color: role.contentChrome,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
  },
  rowPrimary: {
    "::before": { content: "''", position: "absolute", inset: 0 },
  },
  /**
   * A folder header is a group label, not a list cell: it leaves `--_row-fill`
   * unset, so the revealed action's own hover fill is the only background. It
   * still opens on activation, so its cursor follows the app's interactive
   * cursor preference; `interactive` would paint a fill with it.
   */
  workspaceRow: {
    "--_workspace-folder-display": {
      default: "inline-flex",
      ":hover": "none",
      ":focus-within": "none",
    },
    "--_workspace-chevron-display": {
      default: "none",
      ":hover": "inline-flex",
      ":focus-within": "inline-flex",
    },
    cursor: appearance.cursorInteractive,
    flexShrink: 0,
  },
  /** Room for the create action, which floats over the row rather than in it. */
  workspacePrimary: {
    paddingInlineEnd: `calc(${sidebar.actionSize} + 2px)`,
  },
  /**
   * The row owns the fill for itself and its action lane. The lane floats over
   * the row, so it stays a descendant: a pointer on a revealed action is still
   * inside the row, and `:hover` holds the fill under it.
   *
   * The isolation is for the selection layer, which `Row.Backdrop` paints at
   * `z-index: -1`; without a stacking context here it would sink behind the
   * list instead of behind the row.
   */
  sessionRow: {
    "--_row-meta-color": role.contentSecondary,
    "--_row-fill": {
      default: "transparent",
      ":hover": role.bgHover,
      ":focus-within": role.bgHover,
    },
    /*
     * The trailing lane is reserved only for what is showing. The time, when
     * the row carries one, sits in flow and always holds its column; the
     * actions claim their width only once they appear. Reserving them
     * permanently costs every row 44px of title for a state it is almost never
     * in, and re-running the ellipsis on hover is the cheaper of the two, being
     * the state the eye is already moving through.
     */
    cursor: appearance.cursorInteractive,

    userSelect: "none",
    WebkitUserDrag: "none",
  },
  /**
   * Opening the room between the title and the time, rather than at the end of
   * the row, keeps the time where it was: the title is the only thing that
   * gives way to the actions. The width multiplies `Row`'s own reveal flag, so
   * the room and the lane cannot fall out of step.
   */
  sessionLabel: {
    marginInlineEnd: `calc(var(--_row-actions-opacity, 0) * ${sidebar.trailingWidth})`,
  },
  /**
   * A row that needs you carries a second line: the question asked, or why the
   * run failed. Every other row keeps one line, so height goes only where a
   * decision is pending.
   */
  sessionRowAsk: {
    minHeight: { default: 40, "@media (pointer: coarse)": 52 },
    alignItems: "flex-start",
    paddingBlock: 4,
  },
  /** The time rides the title line, so the second line runs the row's full width. */
  sessionTitleLine: {
    display: "flex",
    alignItems: "center",
    gap: sidebar.rowGap,
    minWidth: 0,
  },
  /** The actions cover the title line's box, clear of the second line. */
  rowActionsAsk: {
    top: 4,
    height: type.leadingBase,
    transform: "none",
  },
  rowIconAsk: { alignSelf: "flex-start", paddingBlockStart: 2 },
  sessionAsk: { color: role.contentSecondary },
  /** Replaces the row's title while renaming; same footprint, so the list does not jump. */
  sessionRenameRow: {
    "--_row-fill": role.bgInteractiveSecondaryTranslucent,
  },
  sessionRenameInput: {
    // The label is a plain box, not a flex line, so the field fills it by width.
    width: "100%",
    height: 22,
    borderRadius: shape.indicator,
    borderColor: role.borderSecondaryTranslucent,
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: 1,
    outlineColor: appearance.focusRing,
    outlineOffset: -1,
  },
  /** The layer `Row.Backdrop` positions behind the row; only the tone is ours. */
  sessionSelection: {
    backgroundColor: role.bgInteractiveSecondaryTranslucent,
    boxShadow: `inset 0 0 0 1px ${role.borderPrimary}`,
  },
  rowSelected: {
    // The selection layer behind the row is the fill; hover must not add a second.
    "--_row-fill": "transparent",
    "--_row-meta-color": role.contentSecondary,
    color: role.contentPrimary,
  },
  draftRow: { color: role.contentSecondary },
  /** The status glyph's box, so a badge can sit on its corner without moving the label. */
  sessionBadgeHost: {
    position: "relative",
    display: "grid",
    placeItems: "center",
    width: "100%",
    height: "100%",
  },
  /** Where a chat runs, when that is not this machine. The sidebar fill rings it off the glyph. */
  sessionBadge: {
    position: "absolute",
    insetInlineEnd: -4,
    insetBlockEnd: -3,
    display: "grid",
    placeItems: "center",
    width: 12,
    height: 12,
    borderRadius: shape.pill,
    backgroundColor: role.sidebarMaterial,
    color: role.contentSecondary,
  },
  /**
   * A chat whose machine can't be reached keeps its place at half weight. The
   * content fades, not the row, so a selected row keeps a solid selection.
   */
  sessionUnreachable: { opacity: 0.5 },
  /** The lane's width comes from the rail; this is the tone and the box height. */
  rowIcon: {
    width: sidebar.iconSlot,
    height: sidebar.iconSlot,
    color: role.contentTertiary,
  },
  draftDot: {
    width: 8,
    height: 8,
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: "currentColor",
    borderRadius: shape.pill,
  },
  workspaceGlyph: {
    position: "relative",
    display: "grid",
    placeItems: "center",
    width: "100%",
    height: "100%",
  },
  workspaceFolder: {
    position: "absolute",
    display: "var(--_workspace-folder-display)",
  },
  workspaceChevron: {
    position: "absolute",
    display: "var(--_workspace-chevron-display)",
    transform: "rotate(-90deg)",
    transitionProperty: "transform",
    transitionDuration: {
      default: motion.durationSlow,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOut,
  },
  workspaceChevronOpen: { transform: "rotate(0deg)" },
  workspaceUnavailable: { color: role.contentTertiary },
  rowMeta: {
    minWidth: sidebar.metaWidth,
    justifyContent: "flex-end",
    color: "var(--_row-meta-color)",
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
    letterSpacing: 0.07,
  },
  rowActions: {
    gap: 2,
  },
  /** On a timed row the lane stops a row gap short of the time's column. */
  rowActionsBesideMeta: {
    insetInlineEnd: `calc(${sidebar.rowPaddingInline} + ${sidebar.metaWidth} + ${sidebar.rowGap})`,
  },
  /** Archive's box+lid is heavy below the grid; lift the glyph, not the hit target. */
  actionGlyphArchive: {
    display: "grid",
    placeItems: "center",
    lineHeight: 0,
    transform: "translateY(-1px)",
  },
  rowDragging: {
    cursor: "grabbing",
    opacity: 0.65,
    userSelect: "none",
    WebkitUserDrag: "none",
  },
  workspaceActions: {
    transitionProperty: "opacity",
    transitionDuration: motion.durationFast,
    transitionTimingFunction: motion.easeOut,
  },
  sessionList: {
    display: { default: "flex", "[hidden]": "none" },
    flexDirection: "column",
    gap: sidebar.listGap,
    flexShrink: 0,
  },
  sessionGroupLabel: {
    minHeight: sidebar.rowHeight,
    paddingInlineStart: `calc(${sidebar.rowPaddingInline} + ${sidebar.iconSlot} + ${sidebar.rowGap})`,
    paddingInlineEnd: sidebar.rowPaddingInline,
    paddingBlock: 4,
    color: role.contentSecondary,
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
    userSelect: "none",
  },
  quiet: {
    display: "flex",
    alignItems: "center",
    minHeight: sidebar.rowHeight,
    paddingInline: sidebar.rowPaddingInline,
    paddingBlock: 0,
    color: role.contentSecondary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    flexShrink: 0,
  },
  sessionQuiet: {
    paddingInlineStart: `calc(${sidebar.rowPaddingInline} + ${sidebar.iconSlot} + ${sidebar.rowGap})`,
  },
  showMore: {
    "--_row-fill": { default: "transparent", ":hover": role.bgHover },
    paddingInline: `calc(${sidebar.rowPaddingInline} + ${sidebar.iconSlot} + ${sidebar.rowGap})`,
    borderRadius: shape.control,
    color: { default: role.contentInteractiveSecondary, ":disabled": role.contentDisabled },
    fontSize: type.fontBase,
  },
  footer: {
    display: "flex",
    flexDirection: "column",
    gap: sidebar.listGap,
    paddingInline: sidebar.gutter,
    paddingBlock: sidebar.gutter,
    flexShrink: 0,
  },
  footerRow: { display: "flex", alignItems: "center", gap: 2, minWidth: 0 },
  // The footer is the one row that is always on screen. It answers the pointer
  // with its label and glyph alone, so a resting rail never carries a lit row.
  accountButton: {
    "--_row-fill": "transparent",
    width: "auto",
    minWidth: 0,
    flex: 1,
  },
  avatarSlot: {
    width: sidebar.iconSlot,
    height: sidebar.iconSlot,
    borderRadius: shape.indicator,
    overflow: "hidden",
  },
  avatar: { display: "block", width: "100%", height: "100%", objectFit: "cover" },
  /**
   * Pointing is not selecting: with the menu's hover highlight off, the label
   * brightens under the pointer and the fill stays the keyboard cursor's, so a
   * filled row always means "Enter opens this". The danger item keeps its own
   * colour, which already reads as a state.
   */
  accountMenuItem: {
    color: {
      default: role.contentSecondary,
      ":hover": role.contentPrimary,
      ":is([data-highlighted])": role.contentPrimary,
      ":is([data-disabled])": role.contentDisabled,
    },
  },
});
