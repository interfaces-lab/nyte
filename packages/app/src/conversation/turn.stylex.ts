/** A turn: the user's bubble, the response, and what the turn changed. */
import { create } from "@stylexjs/stylex";
import { glyph, layer, radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { conversation } from "../theme/schema.stylex.ts";
import { appearance, motion, role, shadow, type } from "@nyte-ai/ui/styles/vars.stylex";

/**
 * The prompt's own padding; the message editor in `composer.stylex.ts` keeps
 * the same, so an edit leaves text and images where the bubble had them.
 */
const USER_PROMPT_PADDING_BLOCK = 8;

const USER_PROMPT_PADDING_INLINE = 10;

const USER_IMAGES_GAP = 8;

export const USER_MESSAGE_PREVIEW_LINES = 3.5;

/** Room for a chip's background above the first line, which the clip would cut. */
const USER_PREVIEW_BLEED_TOP = 2;

/**
 * The collapsed-message fade spans the clipped fractional line
 * plus the whole line above it, and runs out through the prompt's bottom
 * padding. The half line is gone before the clip, so nothing reads as sliced
 * text against the prompt's edge.
 */
const USER_PREVIEW_FADE = `calc(${type.leadingLg} * ${(USER_MESSAGE_PREVIEW_LINES % 1) + 1} + ${USER_PROMPT_PADDING_BLOCK}px)`;

/** The user prompt's side of a turn, spanning the measure behind its bubble. */
export const messageStyles = create({
  end: {
    position: "relative",
    width: "100%",
    minWidth: 0,
    borderRadius: radius.card,
    backgroundColor: role.conversationUserShellBg,
  },
});

export const bubbleStyles = create({
  default: {
    boxSizing: "border-box",
    display: "block",
    width: "100%",
    minWidth: 0,
    paddingBlock: USER_PROMPT_PADDING_BLOCK,
    paddingInline: USER_PROMPT_PADDING_INLINE,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: {
      default: role.borderSecondaryTranslucent,
      ":has(:focus-visible)": role.borderPrimaryTranslucent,
      ':hover:has([data-slot="row-primary"])': {
        "@media (hover: hover) and (pointer: fine)": role.borderPrimaryTranslucent,
      },
    },
    borderRadius: radius.card,
    backgroundColor: role.bgElevated,
    boxShadow: "var(--_user-prompt-shadow, none)",
    color: role.contentPrimary,
    textAlign: "start",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    userSelect: "text",
    cursor: { default: null, ':has([data-slot="row-primary"])': appearance.cursorInteractive },
    outlineStyle: "none",
    transitionProperty: "border-color, box-shadow",
    transitionDuration: {
      default: motion.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOut,
  },
});

export const turnStyles = create({
  turn: {
    display: "flex",
    flexDirection: "column",
    gap: conversation.rowGap,
    width: "100%",
    minWidth: 0,
    /**
     * The sticky prompt sticks against the outer scrollport, not its turn;
     * layout containment leaves that alone (no overflow clip, no scroller).
     */
    contain: "layout",
  },
  /**
   * The row's inset is the transcript's top edge while the prompt is stuck:
   * it paints the pane colour, so rows scrolling past vanish behind it instead
   * of surfacing above the prompt. The scrollport drops its own fade then,
   * which would otherwise make this strip translucent.
   */
  userRow: {
    position: { default: "sticky", "[data-sticky-disabled='true']": "relative" },
    zIndex: { default: layer.stickyContent, "[data-sticky-disabled='true']": "auto" },
    top: 0,
    boxSizing: "border-box",
    width: "100%",
    minWidth: 0,
    paddingTop: space.s2_5,
    marginBottom: space.s1,
    backgroundColor: { default: null, "[data-sticky-active='true']": role.bgBase },
    "--_user-prompt-shadow": {
      default: "none",
      "[data-sticky-active='true']": shadow.shadowSm,
    },
  },
  userPreview: { display: "block", minWidth: 0 },
  userPreviewCollapsed: {
    overflow: "clip",
    maxHeight: `calc(${type.leadingLg} * ${USER_MESSAGE_PREVIEW_LINES})`,
  },
  /**
   * The preview bleeds into the prompt's padding so the fade has somewhere to
   * finish; negative margins give the bleed back, leaving the row's height and
   * the toggle's place unchanged.
   */
  userPreviewFade: {
    maxHeight: `calc(${type.leadingLg} * ${USER_MESSAGE_PREVIEW_LINES} + ${USER_PREVIEW_BLEED_TOP + USER_PROMPT_PADDING_BLOCK}px)`,
    paddingTop: USER_PREVIEW_BLEED_TOP,
    marginTop: -USER_PREVIEW_BLEED_TOP,
    paddingBottom: USER_PROMPT_PADDING_BLOCK,
    marginBottom: -USER_PROMPT_PADDING_BLOCK,
    maskImage: `linear-gradient(to bottom, #000 calc(100% - ${USER_PREVIEW_FADE}), transparent 100%)`,
  },
  userPreviewToggle: { marginBlockStart: space.s1 },
  userImages: {
    display: "flex",
    flexWrap: "wrap",
    gap: USER_IMAGES_GAP,
    paddingBlockEnd: USER_IMAGES_GAP,
  },
  changesCard: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: space.s0_5,
    width: "100%",
    paddingBlock: space.s2,
    paddingInline: space.s3,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: role.borderSecondaryTranslucent,
    borderRadius: radius.card,
    backgroundColor: role.bgElevated,
    color: role.contentPrimary,
  },
  changesHeader: {
    display: "flex",
    alignItems: "center",
    gap: space.s3,
  },
  changesTitle: {
    flex: 1,
    minWidth: 0,
  },
  changesReview: { marginBlock: `calc(${space.s0_5} * -1)` },
  changesList: {
    display: "flex",
    flexDirection: "column",
    gap: space.s0_5,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  changesFile: {
    "--_row-fill": {
      default: "transparent",
      ":hover": { "@media (hover: hover) and (pointer: fine)": role.bgHover },
      ":focus-within": role.bgHover,
      ":active": role.bgPressed,
    },
    color: role.contentSecondary,
  },
  changesFileIcon: { position: "relative", insetBlockStart: 1, width: glyph.md },
  changesStats: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s2,
    flexShrink: 0,
    fontVariantNumeric: "tabular-nums",
  },
  changesAdded: { color: role.contentSecondary },
  changesRemoved: { color: role.contentSecondary },
  // The edit is the composer frame itself; this only stacks an error line above it.
  userEdit: {
    display: "flex",
    flexDirection: "column",
    gap: space.s1_5,
    width: "100%",
    minWidth: 0,
  },
  userEditError: {
    minWidth: 0,
    paddingInlineStart: space.s1,
    overflow: "hidden",
    color: role.contentSecondary,
    fontSize: type.fontXs,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  disclosureToggle: {
    width: "fit-content",
    minHeight: conversation.rowMinHeight,
  },
  history: { display: "flex", flexDirection: "column", minWidth: 0 },
  historyBody: {
    boxSizing: "border-box",
    width: "100%",
    marginTop: space.s1,
    paddingBlock: space.s0_5,
    paddingInlineStart: space.s3,
    borderInlineStartWidth: 1,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: role.borderPrimaryTranslucent,
    color: role.contentSecondary,
  },
});
