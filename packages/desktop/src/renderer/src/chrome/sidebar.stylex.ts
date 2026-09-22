/**
 * Sidebar feature styles.
 * Based on https://github.com/interfaces-lab/honk/blob/main/packages/app/src/desktop-extensions/vertical-sidebar/view.tsx
 */
import * as stylex from "@stylexjs/stylex";
import { sidebar } from "../theme/schema.stylex.ts";
import { t } from "../theme/vars.stylex.ts";

export const sidebarStyles = stylex.create({
  rail: {
    // The rail is the surface that measures its rows: `Row` owns structure and
    // reads its geometry from these four variables. The leading lane is fixed
    // so a 14px folder glyph and an 8px draft dot start their labels on the
    // same edge.
    "--nyte-row-height": sidebar.rowHeight,
    "--nyte-row-gap": sidebar.rowGap,
    "--nyte-row-padding-inline": sidebar.rowPaddingInline,
    "--nyte-row-leading-size": sidebar.iconSlot,
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
    "--_sidebar-motion-duration": t.durationNormal,
    "--_sidebar-motion-easing": t.easeOutQuint,
    // Archiving is a dismissal, not a rearrangement: one short slide, no glide.
    "--_sidebar-archive-duration": t.durationFast,
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
  contentLayer: {
    display: { default: "flex", "[hidden]": "none" },
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
   * A rail row that is itself the button, shared with the settings rail. It is
   * not a `Row`: `settings-navigation.tsx` renders the same style on a raw
   * button, so the block still carries its own geometry.
   */
  navRow: {
    "--_shortcut-opacity": {
      default: "0",
      ":hover": { "@media (hover: hover) and (pointer: fine)": "1" },
      ":focus-visible": "1",
    },
    display: "flex",
    alignItems: "center",
    gap: sidebar.rowGap,
    width: "100%",
    height: sidebar.rowHeight,
    paddingBlock: 0,
    paddingInline: sidebar.rowPaddingInline,
    borderRadius: t.radiusLg,
    borderStyle: "none",
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover) and (pointer: fine)": t.fillGhostHover },
    },
    color: {
      default: t.textSecondary,
      ":hover": { "@media (hover: hover) and (pointer: fine)": t.textPrimary },
      ":focus-visible": t.textPrimary,
    },
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
    fontWeight: 400,
    textAlign: "left",
    cursor: { default: "pointer", ":disabled": "default" },
    opacity: { default: 1, ":disabled": 0.5 },
    flexShrink: 0,
    transitionProperty: "background-color",
    transitionDuration: t.durationFast,
    transitionTimingFunction: t.easeOut,
  },
  navRowActive: {
    "--_shortcut-opacity": "1",
    backgroundColor: {
      default: t.fillGhostSelected,
      ":hover": { "@media (hover: hover) and (pointer: fine)": t.fillGhostSelected },
    },
    color: t.textPrimary,
  },
  navIcon: {
    display: "grid",
    placeItems: "center",
    width: sidebar.iconSlot,
    height: sidebar.iconSlot,
    color: "inherit",
    flexShrink: 0,
  },
  navLabel: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  shortcutSlot: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    minWidth: sidebar.trailingWidth,
    flexShrink: 0,
    opacity: "var(--_shortcut-opacity)",
    transitionProperty: "opacity",
    transitionDuration: t.durationFast,
    transitionTimingFunction: t.easeOut,
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
    color: t.textTertiary,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
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
    borderStyle: "none",
    borderRadius: t.radiusBase,
    backgroundColor: "transparent",
    color: "inherit",
    fontSize: "inherit",
    textAlign: "left",
    cursor: "pointer",
  },
  sectionChevron: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    color: t.iconTertiary,
    opacity: "var(--_section-chevron-opacity)",
    transform: "rotate(0deg)",
    transitionProperty: "transform",
    transitionDuration: {
      default: t.durationNormal,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: t.easeOut,
  },
  sectionChevronOpen: { transform: "rotate(90deg)" },
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
  /**
   * The tones every sidebar row shares. `Row` owns the structure and reads its
   * geometry from the rail; this is only what the surface sounds different on.
   */
  rowSurface: {
    borderRadius: t.radiusBase,
    color: t.textSecondary,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
  },
  rowPrimary: {
    "::before": { content: "''", position: "absolute", inset: 0 },
  },
  /**
   * A folder header is a group label, not a list cell: it leaves `--_row-fill`
   * unset, so the revealed action's own hover fill is the only background. The
   * pointer still has to read as "this opens", so the cursor is set here;
   * `interactive` would paint a fill with it.
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
    cursor: "pointer",
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
    "--_row-meta-color": t.textTertiary,
    "--_row-fill": {
      default: "transparent",
      ":hover": t.fillGhostHover,
      ":focus-within": t.fillGhostHover,
    },
    /*
     * The trailing lane is reserved only for what is showing. The time, when
     * the row carries one, sits in flow and always holds its column; the
     * actions claim their width only once they appear. Reserving them
     * permanently costs every row 44px of title for a state it is almost never
     * in, and re-running the ellipsis on hover is the cheaper of the two, being
     * the state the eye is already moving through.
     */
    cursor: "pointer",
    touchAction: "none",
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
  /** Replaces the row's title while renaming; same footprint, so the list does not jump. */
  sessionRenameRow: {
    "--_row-fill": t.fillGhostSelected,
  },
  sessionRenameInput: {
    // The label is a plain box, not a flex line, so the field fills it by width.
    width: "100%",
    minWidth: 0,
    height: 22,
    paddingInline: 6,
    borderRadius: t.radiusSm,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: { default: t.strokeSecondary, ":focus-visible": t.strokeFocused },
    backgroundColor: t.bgElevated,
    color: t.textPrimary,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
    outline: "none",
  },
  /** The layer `Row.Backdrop` positions behind the row; only the tone is ours. */
  sessionSelection: {
    backgroundColor: t.fillGhostSelected,
  },
  rowSelected: {
    // The selection layer behind the row is the fill; hover must not add a second.
    "--_row-fill": "transparent",
    "--_row-meta-color": t.textSecondary,
    color: t.textPrimary,
  },
  draftRow: { color: t.textTertiary },
  /** The lane's width comes from the rail; this is the tone and the box height. */
  rowIcon: {
    height: sidebar.iconSlot,
    color: t.iconTertiary,
  },
  draftDot: {
    width: 8,
    height: 8,
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: "currentColor",
    borderRadius: t.radiusFull,
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
      default: t.durationSlow,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: t.easeOut,
  },
  workspaceChevronOpen: { transform: "rotate(0deg)" },
  workspaceUnavailable: { color: t.textTertiary },
  rowMeta: {
    minWidth: sidebar.metaWidth,
    justifyContent: "flex-end",
    color: "var(--_row-meta-color)",
    fontSize: t.fontXs,
    lineHeight: t.leadingXs,
    letterSpacing: 0.07,
  },
  rowActions: {
    gap: 2,
  },
  /** On a timed row the lane stops a row gap short of the time's column. */
  rowActionsBesideMeta: {
    insetInlineEnd: `calc(${sidebar.rowPaddingInline} + ${sidebar.metaWidth} + ${sidebar.rowGap})`,
  },
  /**
   * A 16px target on the 14px caption line. The row already paints the hover
   * fill behind it, so the button reads its own hover through icon color only —
   * two stacked ghost fills render as one muddy block.
   *
   * The pointer target is larger than the glyph: the row's full height, and
   * half the 2px gap either side, so the two actions sit adjacent without
   * their targets overlapping. Radius steps down from the row's, since the
   * button is inset within it.
   */
  sessionAction: {
    position: "relative",
    width: 16,
    height: 16,
    borderRadius: t.radiusSm,
    backgroundColor: "transparent",
    "::after": {
      content: "''",
      position: "absolute",
      insetBlock: -6,
      insetInline: -1,
    },
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
  action: {
    display: "grid",
    placeItems: "center",
    width: sidebar.actionSize,
    height: sidebar.actionSize,
    padding: 0,
    borderStyle: "none",
    borderRadius: t.radiusBase,
    backgroundColor: "transparent",
    color: { default: t.iconTertiary, ":hover:not(:disabled)": t.iconPrimary },
    cursor: { default: "pointer", ":disabled": "default" },
    opacity: { default: 1, ":disabled": 0.5 },
    lineHeight: 0,
  },
  workspaceCreateAction: {
    display: "grid",
    placeItems: "center",
    width: sidebar.actionSize,
    height: sidebar.actionSize,
    padding: 0,
    borderStyle: "none",
    borderRadius: t.radiusBase,
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover) and (pointer: fine)": t.fillGhostHover },
    },
    color: t.iconTertiary,
    cursor: "pointer",
    lineHeight: 0,
    transitionProperty: "background-color",
    transitionDuration: t.durationFast,
    transitionTimingFunction: t.easeOut,
  },
  /**
   * The folder action fades in. Nothing reflows with it — the header reserves
   * its room permanently — so unlike a session row's lane it can take a
   * transition without desynchronising from a title.
   */
  workspaceActions: {
    transitionProperty: "opacity",
    transitionDuration: t.durationFast,
    transitionTimingFunction: t.easeOut,
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
    color: t.textTertiary,
    fontSize: t.fontXs,
    lineHeight: t.leadingXs,
    userSelect: "none",
  },
  quiet: {
    display: "flex",
    alignItems: "center",
    minHeight: sidebar.rowHeight,
    paddingInline: sidebar.rowPaddingInline,
    paddingBlock: 0,
    color: t.textTertiary,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
    flexShrink: 0,
  },
  sessionQuiet: {
    paddingInlineStart: `calc(${sidebar.rowPaddingInline} + ${sidebar.iconSlot} + ${sidebar.rowGap})`,
  },
  showMore: {
    display: "flex",
    alignItems: "center",
    width: "100%",
    minHeight: sidebar.rowHeight,
    paddingInline: `calc(${sidebar.rowPaddingInline} + ${sidebar.iconSlot} + ${sidebar.rowGap})`,
    borderStyle: "none",
    borderRadius: t.radiusBase,
    backgroundColor: { default: "transparent", ":hover": t.fillGhostHover },
    color: t.textTertiary,
    fontSize: t.fontBase,
    textAlign: "left",
    cursor: { default: "pointer", ":disabled": "default" },
    opacity: { default: 1, ":disabled": 0.72 },
    flexShrink: 0,
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
    width: "auto",
    minWidth: 0,
    flex: 1,
    backgroundColor: "transparent",
  },
  footerSettings: {
    display: "grid",
    placeItems: "center",
    width: sidebar.rowHeight,
    height: sidebar.rowHeight,
    padding: 0,
    borderStyle: "none",
    borderRadius: t.radiusBase,
    backgroundColor: "transparent",
    color: { default: t.iconTertiary, ":hover": t.iconPrimary },
    cursor: "pointer",
    flexShrink: 0,
  },
  // Open Settings is a state, not a pointer answer, so it keeps its fill.
  footerSettingsActive: {
    backgroundColor: t.fillGhostSelected,
    color: t.iconPrimary,
  },
  avatarSlot: { borderRadius: t.radiusSm, overflow: "hidden" },
  avatar: { display: "block", width: "100%", height: "100%", objectFit: "cover" },
  /**
   * Pointing is not selecting: with the menu's hover highlight off, the label
   * brightens under the pointer and the fill stays the keyboard cursor's, so a
   * filled row always means "Enter opens this". The danger item keeps its own
   * colour, which already reads as a state.
   */
  accountMenuItem: {
    color: {
      default: t.textSecondary,
      ":hover": t.textPrimary,
      ":is([data-highlighted])": t.textPrimary,
      ":is([data-disabled])": t.textDisabled,
    },
  },
});
