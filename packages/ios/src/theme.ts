import { css } from "react-strict-dom";
import { StyleSheet, useColorScheme } from "react-native";
import type { MarkdownStyle } from "react-native-enriched-markdown";
import { platformColors } from "@nyte-ai/ui/platform-colors";

// Raw colors serve native controls outside RSD; RSD gets the same values
// through prefers-color-scheme conditionals on the tokens below.
const schemes = {
  light: {
    background: platformColors.light.sidebar,
    canvas: "#ffffff",
    surface: platformColors.light.background,
    raised: platformColors.light.bubbleAgent,
    fill: platformColors.light.muted,
    foreground: platformColors.light.foreground,
    muted: platformColors.light.mutedForeground,
    tertiary: platformColors.light.tertiaryForeground,
    border: platformColors.light.borderSubtle,
    separator: platformColors.light.borderWeak,
    accent: platformColors.light.accent,
    // A label on an accent fill stays light in both appearances, the way the
    // system tints a prominent button, so both take the dark palette's foreground.
    onAccent: platformColors.dark.foreground,
    primary: platformColors.light.primary,
    onPrimary: platformColors.light.primaryForeground,
    // The platform light success fails contrast as small text; deepen it.
    success: "#007a45",
    danger: platformColors.light.destructive,
    warning: platformColors.light.warning,
    successFill: platformColors.light.avatarGreenBackground,
    dangerFill: platformColors.light.destructiveMuted,
    warningFill: platformColors.light.avatarOrangeBackground,
    shadow: "0 2px 12px rgba(0,0,0,0.08)",
  },
  dark: {
    background: platformColors.dark.sidebar,
    canvas: platformColors.dark.sidebar,
    surface: platformColors.dark.bubbleAgent,
    raised: platformColors.dark.fieldBackground,
    fill: platformColors.dark.muted,
    foreground: platformColors.dark.foreground,
    muted: platformColors.dark.mutedForeground,
    tertiary: platformColors.dark.tertiaryForeground,
    border: platformColors.dark.borderWeak,
    separator: platformColors.dark.borderWeak,
    accent: platformColors.dark.accent,
    onAccent: platformColors.dark.foreground,
    primary: platformColors.dark.primary,
    onPrimary: platformColors.dark.primaryForeground,
    success: platformColors.dark.success,
    danger: platformColors.dark.destructive,
    warning: platformColors.dark.warning,
    successFill: platformColors.dark.avatarGreenBackground,
    dangerFill: platformColors.dark.destructiveMuted,
    warningFill: platformColors.dark.avatarOrangeBackground,
    shadow: "none",
  },
} as const;

export type Theme = Record<keyof (typeof schemes)["light"], string>;
export const themes = schemes;

/** Raw colors for the active appearance — re-renders when the scheme flips. */
export function useTheme(): Theme {
  return useColorScheme() === "dark" ? schemes.dark : schemes.light;
}

function conditional(key: keyof Theme) {
  return {
    default: schemes.light[key],
    "@media (prefers-color-scheme: dark)": schemes.dark[key],
  };
}

export const tokens = css.defineVars({
  background: conditional("background"),
  canvas: conditional("canvas"),
  surface: conditional("surface"),
  raised: conditional("raised"),
  fill: conditional("fill"),
  foreground: conditional("foreground"),
  muted: conditional("muted"),
  tertiary: conditional("tertiary"),
  border: conditional("border"),
  separator: conditional("separator"),
  accent: conditional("accent"),
  onAccent: conditional("onAccent"),
  primary: conditional("primary"),
  onPrimary: conditional("onPrimary"),
  success: conditional("success"),
  danger: conditional("danger"),
  successFill: conditional("successFill"),
  dangerFill: conditional("dangerFill"),
  shadow: conditional("shadow"),
});

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, gutter: 20 };
export const radii = {
  sm: 8,
  tile: 8,
  control: 12,
  card: 16,
  bubble: 20,
  sheet: 28,
  pill: 999,
};

// The measured iphone-01 list rhythm: 20pt gutter, hairlines inset to the text.
export const list = {
  gutter: 20,
  leading: 14,
  // The system spinner draws at 20pt; this brings it down to the glyph column.
  spinnerScale: 0.7,
  leadingGap: 12,
  rowPaddingBlock: 12,
  titleMetaGap: 2,
  sectionGap: 28,
  headerGap: 6,
  tile: 28,
};

export const controls = {
  hairline: StyleSheet.hairlineWidth,
  borderWidth: 1,
  statusDot: 8,
  touchTarget: 44,
  metaTarget: 28,
  // The photo X sits over a corner of the thumbnail; its box reaches past it.
  photoRemoveTarget: 36,
  primaryHeight: 44,
  // A screen's own action, taller than the toolbar controls beside it.
  fillHeight: 50,
  chipHeight: 36,
  composerHeight: 52,
  composerButton: 32,
  iconXs: 12,
  iconSm: 15,
  icon: 17,
  composerMaxHeight: 176,
  badge: 20,
  diffGutter: 40,
  disabledOpacity: 0.4,
  pressedOpacity: 0.6,
} as const;

export const conversation = {
  contentMaxWidth: 768,
  gutter: spacing.md,
  textInset: spacing.sm,
};

export const media = {
  attachmentSize: 56,
  recentThumb: 72,
  thumbnailWidth: 180,
  thumbnailHeight: 140,
  bubbleMaxWidthRatio: 0.8,
  scanReticle: 240,
} as const;

/**
 * Chrome drawn over a camera preview or a photo. These do not follow the
 * appearance: what sits behind them is never the app's surface.
 */
export const overCamera = {
  backdrop: "#000",
  foreground: "#fff",
  scrim: "rgba(0,0,0,0.45)",
} as const;

export const typography = {
  body: { fontSize: 16, lineHeight: 22, fontWeight: 400 },
  secondary: { fontSize: 15, lineHeight: 20, fontWeight: 400 },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: 400 },
  label: { fontSize: 13, lineHeight: 18, fontWeight: 500 },
  headline: { fontSize: 16, lineHeight: 22, fontWeight: 600 },
  title: { fontSize: 17, lineHeight: 22, fontWeight: 600 },
  heading: { fontSize: 22, lineHeight: 28, fontWeight: 600 },
  button: { fontSize: 16, lineHeight: 22, fontWeight: 500 },
  error: { fontSize: 15, lineHeight: 20, fontWeight: 400 },
  code: { fontSize: 13, lineHeight: 18, fontWeight: 400, fontFamily: "Menlo" },
  diff: { fontSize: 12, lineHeight: 18, fontWeight: 400, fontFamily: "Menlo" },
  section: { fontSize: 18, lineHeight: 24, fontWeight: 600 },
} as const;

/**
 * A panel that grows out of the composer: the capsule's own surface and radius,
 * raised above the transcript it covers. The attachment choices and the `@`/`/`
 * menu are the same object to the eye, so they are the same rule here.
 */
export const surfaces = css.create({
  panel: {
    borderRadius: radii.bubble,
    borderWidth: controls.hairline,
    borderStyle: "solid",
    borderColor: tokens.border,
    backgroundColor: tokens.surface,
    boxShadow: tokens.shadow,
    overflow: "hidden",
  },
});

// RSD interprets numeric line heights as ratios; native props require pixels.
export const textStyles = css.create({
  body: {
    ...typography.body,
    lineHeight: `${typography.body.lineHeight}px`,
    color: tokens.foreground,
  },
  secondary: {
    ...typography.secondary,
    lineHeight: `${typography.secondary.lineHeight}px`,
    color: tokens.muted,
  },
  caption: {
    ...typography.caption,
    lineHeight: `${typography.caption.lineHeight}px`,
    color: tokens.muted,
  },
  label: {
    ...typography.label,
    lineHeight: `${typography.label.lineHeight}px`,
    color: tokens.foreground,
  },
  headline: {
    ...typography.headline,
    lineHeight: `${typography.headline.lineHeight}px`,
    color: tokens.foreground,
  },
  title: {
    ...typography.title,
    lineHeight: `${typography.title.lineHeight}px`,
    color: tokens.foreground,
  },
  heading: {
    ...typography.heading,
    lineHeight: `${typography.heading.lineHeight}px`,
    color: tokens.foreground,
  },
  error: {
    ...typography.error,
    lineHeight: `${typography.error.lineHeight}px`,
    color: tokens.danger,
  },
  diff: {
    ...typography.diff,
    lineHeight: `${typography.diff.lineHeight}px`,
    color: tokens.foreground,
  },
});

export function markdownStyle(theme: Theme): MarkdownStyle {
  return {
    paragraph: {
      ...typography.body,
      fontWeight: String(typography.body.fontWeight),
      color: theme.foreground,
    },
    h1: {
      ...typography.section,
      fontWeight: String(typography.section.fontWeight),
      color: theme.foreground,
    },
    h2: {
      ...typography.title,
      fontWeight: String(typography.title.fontWeight),
      color: theme.foreground,
    },
    h3: {
      ...typography.headline,
      fontWeight: String(typography.headline.fontWeight),
      color: theme.foreground,
    },
    h4: {
      ...typography.headline,
      fontWeight: String(typography.headline.fontWeight),
      color: theme.foreground,
    },
    h5: {
      ...typography.headline,
      fontWeight: String(typography.headline.fontWeight),
      color: theme.foreground,
    },
    h6: {
      ...typography.headline,
      fontWeight: String(typography.headline.fontWeight),
      color: theme.muted,
    },
    strong: { color: theme.foreground },
    em: { color: theme.foreground },
    link: { color: theme.accent, underline: false },
    list: {
      ...typography.body,
      fontWeight: String(typography.body.fontWeight),
      color: theme.foreground,
      bulletColor: theme.muted,
      markerColor: theme.muted,
    },
    blockquote: {
      ...typography.body,
      fontWeight: String(typography.body.fontWeight),
      color: theme.muted,
      borderColor: theme.separator,
    },
    code: {
      fontSize: typography.code.fontSize,
      fontFamily: typography.code.fontFamily,
      color: theme.foreground,
      backgroundColor: theme.fill,
    },
    codeBlock: {
      ...typography.code,
      fontWeight: String(typography.code.fontWeight),
      color: theme.foreground,
      backgroundColor: theme.raised,
      borderColor: "transparent",
      borderRadius: radii.sm,
      padding: spacing.md,
    },
    thematicBreak: { color: theme.separator },
    table: {
      ...typography.body,
      fontWeight: String(typography.body.fontWeight),
      color: theme.foreground,
      borderColor: theme.separator,
      headerBackgroundColor: theme.raised,
      headerTextColor: theme.foreground,
      rowEvenBackgroundColor: theme.surface,
      rowOddBackgroundColor: theme.canvas,
    },
  };
}
