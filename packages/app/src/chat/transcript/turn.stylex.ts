import { create, keyframes } from "@stylexjs/stylex";
import { control, glyph, layer, media, radius, row, space } from "@nyte-ai/ui/styles/schema.stylex";
import { conversation } from "../../theme/schema.stylex.ts";
import { appearance, motion, role, shadow, type } from "@nyte-ai/ui/styles/vars.stylex";

const USER_PROMPT_PADDING_BLOCK = 8;

const USER_PROMPT_PADDING_INLINE = 10;

const USER_IMAGES_GAP = 8;

export const USER_MESSAGE_PREVIEW_LINES = 3.5;

const userPendingIn = keyframes({
  from: { opacity: 0, transform: "translateY(4px)" },
  to: { opacity: 1, transform: "translateY(0)" },
});

const USER_PREVIEW_BLEED_TOP = 2;

const USER_PREVIEW_FADE = `calc(${type.leadingLg} * ${(USER_MESSAGE_PREVIEW_LINES % 1) + 1} + ${USER_PROMPT_PADDING_BLOCK}px)`;

const CHANGES_BORDER = 1;

const CHANGES_PADDING_BLOCK = space.s2;

const CHANGES_GAP = space.s0_5;

const CHANGES_LEADING = type.leadingBase;

const CHANGES_REVIEW_BLEED = space.s0_5;

const CHANGES_RESERVE_FLOOR = 320;

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
      default: role.strokeQuaternary,
      ":has(:focus-visible)": role.strokeTertiary,
      ':hover:has([data-slot="row-primary"])': {
        [media.hover]: role.strokeTertiary,
      },
    },
    borderRadius: radius.card,
    backgroundColor: role.bgElevated,
    boxShadow: "var(--_user-prompt-shadow, none)",
    color: `var(--_user-prompt-color, ${role.contentPrimary})`,
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
  userRow: {
    pointerEvents: "auto",
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
  userPending: {
    "--_user-prompt-color": role.contentTertiary,
    animationName: {
      default: userPendingIn,
      "@media (prefers-reduced-motion: reduce)": "none",
    },
    animationDuration: motion.durationSlow,
    animationTimingFunction: motion.easeOut,
  },
  userPreview: { display: "block", minWidth: 0 },
  userPreviewCollapsed: {
    overflow: "clip",
    maxHeight: `calc(${type.leadingLg} * ${USER_MESSAGE_PREVIEW_LINES})`,
  },
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
    gap: CHANGES_GAP,
    width: "100%",
    paddingBlock: CHANGES_PADDING_BLOCK,
    paddingInline: space.s3,
    borderWidth: CHANGES_BORDER,
    borderStyle: "solid",
    borderColor: role.strokeQuaternary,
    borderRadius: radius.card,
    backgroundColor: role.bgElevated,
    color: role.contentPrimary,
    fontSize: type.fontBase,
    lineHeight: CHANGES_LEADING,
    letterSpacing: type.letterBase,
  },
  changesFooter: (files: number) => ({
    minHeight: `clamp(0px, 100cqb - ${String(CHANGES_RESERVE_FLOOR)}px, calc(2 * ${String(CHANGES_BORDER)}px + 2 * ${CHANGES_PADDING_BLOCK} + max(${CHANGES_LEADING}, ${control.heightSm} - 2 * ${CHANGES_REVIEW_BLEED}) + ${String(files)} * (${CHANGES_GAP} + ${row.heightMd})))`,
  }),
  changesHeader: {
    display: "flex",
    alignItems: "center",
    gap: space.s3,
  },
  changesTitle: {
    flex: 1,
    minWidth: 0,
  },
  changesReview: { marginBlock: `calc(${CHANGES_REVIEW_BLEED} * -1)` },
  changesList: {
    display: "flex",
    flexDirection: "column",
    gap: CHANGES_GAP,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  changesFile: {
    "--_row-fill": {
      default: "transparent",
      ":hover": { [media.hover]: role.fillTertiary },
      ":focus-within": role.fillTertiary,
      ":active": role.fillSecondary,
    },
    color: role.contentSecondary,
  },
  changesFileIcon: { position: "relative", insetBlockStart: 1, width: glyph.md },
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
    lineHeight: type.leadingXs,
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
    borderInlineStartColor: role.strokeTertiary,
    color: role.contentSecondary,
  },
});
