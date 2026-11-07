import { create } from "@stylexjs/stylex";

const media = { hover: "@media (hover: hover) and (pointer: fine)" } as const;

/**
 * Every value here is deliberate. `design-scale.test.ts` asserts the exact set
 * of lines the rules report, so edit the test when you edit this file.
 */
const ink = "var(--nyte-content-primary)";

export const fixtureStyles = create({
  tokenized: { gap: ink, marginInline: "auto", paddingInline: "1em", marginBlockStart: 0 },
  onScale: { gap: 8, paddingInline: 12 },
  negativeOnScale: { marginTop: -4 },
  offScale: { gap: 7, paddingBlock: 9 },
  aboveScale: { paddingInlineStart: 96 },
  negative: { marginInline: -5 },
  condition: { gap: { default: 0, ":hover": { "@media (hover: hover) and (pointer: fine)": 5 } } },
  pseudo: { "::after": { paddingInline: 3 } },
  shorthandString: { padding: "5px 10px" },
  mixedShorthand: { margin: "8px auto" },
  computedString: { padding: "calc(100% - 3px)", width: "min(608px, 100%)" },
  sizes: { width: 28, minHeight: 24 },
  hairline: { width: 1, height: 1.5 },
  offGridSize: { width: 15, minHeight: 61 },
  // Not a length: a stacking order, a count, and a ratio are not on the grid.
  notLengths: { zIndex: 9, flexGrow: 3, opacity: 0.5, lineHeight: 15 },
  // A style may be named after a property without governing what is inside it.
  gap: { zIndex: 7, fontSize: 13 },
  rawWeight: { fontWeight: 600 },
  stringWeight: { fontWeight: { default: "500", ":focus": 400 } },
  offTokenWeight: { fontWeight: 700 },
  handleWeight: { fontWeight: "var(--nyte-font-weight-medium)", fontStyle: "normal" },
  keywordWeight: { fontWeight: "bold" },
  lightDark: { color: "light-dark(#000, #fff)" },
  lightDarkTemplate: { backgroundColor: { ":focus": `light-dark(${ink}, transparent)` } },
  unguardedHover: { color: { default: ink, ":hover": ink } },
  hoverDefault: {
    color: { ":hover": { default: ink, "@media (hover: hover) and (pointer: fine)": ink } },
  },
  guardedHover: { color: { default: ink, ":hover": { [media.hover]: ink } } },
  mediaOutsideHover: { color: { [media.hover]: { ":hover": ink } } },
  ancestorHover: { color: { ":is(tr:hover *)": ink } },
  disableable: {
    color: {
      default: ink,
      ":hover": { [media.hover]: ink },
      ":disabled": ink,
      "[data-disabled]": ink,
    },
  },
  partlyExcluded: {
    color: { ":hover:not([data-disabled])": { [media.hover]: ink }, ":disabled": ink },
  },
  excluded: {
    color: { ":hover:not(:disabled, [data-disabled])": { [media.hover]: ink }, ":disabled": ink },
    cursor: { "[data-disabled]": "default" },
  },
  physicalPadding: { paddingLeft: ink },
  physicalInset: { "::before": { right: 0 } },
  physicalAlign: { textAlign: { default: "start", ":hover": { [media.hover]: "right" } } },
  logicalSides: {
    paddingInlineStart: ink,
    insetInlineEnd: 0,
    textAlign: "end",
    float: "inline-start",
  },
  centred: { left: "50%", translate: "-50% -50%" },
  centredTransform: { left: "50%", transform: "translate(-50%, -50%)" },
  leftWithoutTranslate: { left: "50%", translate: "0 -50%" },
  logicalCentred: { insetInlineStart: "50%", transform: "translateX(-50%)" },
});

// The bare `create` import is the more common form in the renderer.
export const bareStyles = create({
  bare: { gap: 7 },
  blockBody: (inset: number) => {
    return { paddingInline: 3, marginInline: inset };
  },
});

const role = {
  contentPrimary: "var(--nyte-content-primary)",
  contentSecondary: "var(--nyte-content-secondary)",
  contentTertiary: "var(--nyte-content-tertiary)",
  contentAccent: "var(--nyte-content-accent)",
  contentDisabled: "var(--nyte-content-disabled)",
} as const;

const when = { ancestor: (selector: string) => `:where(${selector}) &` };

// Button's disabled state, read through its constant.
const disabledState = "[data-disabled]:not([aria-busy='true'])";

// The tool line's dimmed ink before the stairs, mixed outside create().
const DIMMED = `color-mix(in oklab, ${role.contentSecondary} 65%, ${role.contentTertiary})`;

export const inkStyles = create({
  // The step group's thinking text before the stairs.
  thinking: { minWidth: 0, color: role.contentSecondary, opacity: 0.5 },
  fadedPseudo: { "::after": { color: role.contentTertiary, opacity: { default: "60%" } } },
  fadedText: { color: `color-mix(in srgb, ${role.contentPrimary} 60%, transparent)` },
  rawMix: { color: "color-mix(in srgb, var(--nyte-content-primary) 70%, var(--nyte-bg-base))" },
  dimmed: { "--_action": DIMMED },
  fadeOut: { color: role.contentPrimary, opacity: { default: 1, "[data-ending-style]": 0 } },
  fadedImage: { opacity: 0.5 },
  fadedVariable: { color: role.contentSecondary, opacity: "var(--_fade, 1)" },
  // A disabled control fades whole; the contrast floors exempt it.
  fadedDisabled: { color: role.contentPrimary, opacity: { default: 1, "[data-disabled]": 0.5 } },
  tabDisabled: { color: role.contentSecondary, opacity: 0.5 },
  fadedHover: { color: role.contentPrimary, ":hover": { [media.hover]: { opacity: 0.5 } } },
  fadedAroundInk: { opacity: 0.5, "::after": { color: role.contentPrimary } },
  fadedWhileEnabled: { ":not(:disabled)": { color: role.contentPrimary, opacity: 0.5 } },
  offBlock: { ":disabled": { color: role.contentPrimary, opacity: 0.5 } },
  inkWhenOff: { opacity: 0.5, ":disabled": { color: role.contentPrimary } },
  accentWash: { backgroundColor: `color-mix(in oklab, ${role.contentAccent} 10%, transparent)` },
  // The download filename that failed, before the stairs.
  failed: { color: role.contentDisabled },
  idleRing: { boxShadow: `inset 0 0 0 1px ${role.contentDisabled}` },
  control: {
    color: {
      default: role.contentPrimary,
      ":disabled": role.contentDisabled,
      "[data-disabled]": role.contentDisabled,
      '[aria-disabled="true"]': role.contentDisabled,
      [when.ancestor("[data-disabled]")]: role.contentDisabled,
      [disabledState]: role.contentDisabled,
    },
  },
  enabledOnly: {
    color: { default: role.contentPrimary, ":not([data-disabled])": role.contentDisabled },
  },
  bothBranches: (disabled: boolean) => ({
    color: disabled ? role.contentDisabled : role.contentDisabled,
  }),
  inverted: (disabled: boolean) => ({
    color: !disabled ? role.contentPrimary : role.contentDisabled,
  }),
  rowDisabled: { color: role.contentDisabled },
  toggled: (disabled: boolean) => ({
    color: disabled ? role.contentDisabled : role.contentPrimary,
  }),
});

/**
 * Known holes, asserted as silent so a future fix is a visible test change:
 * a value the compiler resolves rather than the linter, and a plain object.
 */
const SPACING = 7;

export const unreadable = create({ indirect: { gap: SPACING } });

export const measurement = { gap: 7, width: 15, fontWeight: 600, color: "light-dark(red, blue)" };
