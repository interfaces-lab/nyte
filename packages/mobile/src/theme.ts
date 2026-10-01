import { css } from "react-strict-dom";
import { StyleSheet, useColorScheme } from "react-native";
import type { MarkdownStyle } from "react-native-enriched-markdown";
import { platformColors, platformScopes } from "@nyte-ai/ui/platform-colors";

// Raw colors serve native controls outside RSD; RSD gets the same values
// through prefers-color-scheme conditionals on the tokens below.
const schemes = {
  light: {
    background: platformColors.light.bgChrome,
    canvas: platformColors.light.bgBase,
    surface: platformColors.light.bgBase,
    raised: platformColors.light.bgPressed,
    fill: platformColors.light.bgInteractiveSecondaryTranslucent,
    foreground: platformColors.light.contentPrimary,
    muted: platformColors.light.contentSecondary,
    tertiary: platformColors.light.contentTertiary,
    interactiveTertiary: platformColors.light.contentInteractiveTertiary,
    border: platformColors.light.borderSecondaryTranslucent,
    separator: platformColors.light.borderSecondaryTranslucent,
    accent: platformScopes.light.blue.contentSecondary,
    accentFill: platformScopes.light.blue.buttonFill,
    onAccentFill: platformScopes.light.blue.contentOnInteractiveStrong,
    primary: platformColors.light.bgInteractiveStrong,
    onPrimary: platformColors.light.contentOnInteractiveStrong,
    success: platformScopes.light.green.contentSecondary,
    danger: platformScopes.light.red.contentSecondary,
    warning: platformScopes.light.yellow.contentSecondary,
    successFill: platformScopes.light.green.bgInteractiveSecondaryTranslucent,
    dangerFill: platformScopes.light.red.bgInteractiveSecondaryTranslucent,
    warningFill: platformScopes.light.yellow.bgInteractiveSecondaryTranslucent,
    shadow: "0 2px 12px rgba(0,0,0,0.08)",
  },
  dark: {
    background: platformColors.dark.bgChrome,
    canvas: platformColors.dark.bgChrome,
    surface: platformColors.dark.bgElevated,
    raised: platformColors.dark.bgPressed,
    fill: platformColors.dark.bgInteractiveSecondaryTranslucent,
    foreground: platformColors.dark.contentPrimary,
    muted: platformColors.dark.contentSecondary,
    tertiary: platformColors.dark.contentTertiary,
    interactiveTertiary: platformColors.dark.contentInteractiveTertiary,
    border: platformColors.dark.borderSecondaryTranslucent,
    separator: platformColors.dark.borderSecondaryTranslucent,
    accent: platformScopes.dark.blue.contentSecondary,
    accentFill: platformScopes.dark.blue.buttonFill,
    onAccentFill: platformScopes.dark.blue.contentOnInteractiveStrong,
    primary: platformColors.dark.bgInteractiveStrong,
    onPrimary: platformColors.dark.contentOnInteractiveStrong,
    success: platformScopes.dark.green.contentSecondary,
    danger: platformScopes.dark.red.contentSecondary,
    warning: platformScopes.dark.yellow.contentSecondary,
    successFill: platformScopes.dark.green.bgInteractiveSecondaryTranslucent,
    dangerFill: platformScopes.dark.red.bgInteractiveSecondaryTranslucent,
    warningFill: platformScopes.dark.yellow.bgInteractiveSecondaryTranslucent,
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
  interactiveTertiary: conditional("interactiveTertiary"),
  border: conditional("border"),
  separator: conditional("separator"),
  accent: conditional("accent"),
  accentFill: conditional("accentFill"),
  onAccentFill: conditional("onAccentFill"),
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
  composer: 23,
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
  // Flat rows lead with a hairline ring instead of the filled tile.
  ring: 24,
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
  // Resting morphing pill plus a little air; screens add the home-indicator inset.
  composerBar: 64,
  iconXs: 12,
  iconSm: 15,
  icon: 17,
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
    borderRadius: radii.composer,
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

/** The face the transcript's prose is set in. */
export type TranscriptFont = "system" | "monospaced";

export function markdownStyle(
  theme: Theme,
  transcriptFont: TranscriptFont,
  scheme: keyof typeof schemes,
): MarkdownStyle {
  // A monospaced transcript borrows the face the code blocks already use, so a
  // reply reads as one font rather than two.
  const prose =
    transcriptFont === "monospaced" ? { fontFamily: typography.code.fontFamily } : undefined;
  const scopes = platformScopes[scheme];

  return {
    paragraph: {
      ...typography.body,
      ...prose,
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
      ...prose,
      fontWeight: String(typography.body.fontWeight),
      color: theme.foreground,
      bulletColor: theme.muted,
      markerColor: theme.muted,
    },
    blockquote: {
      ...typography.body,
      ...prose,
      fontWeight: String(typography.body.fontWeight),
      color: theme.muted,
      borderColor: theme.separator,
      backgroundColor: "transparent",
    },
    code: {
      fontSize: typography.code.fontSize,
      fontFamily: typography.code.fontFamily,
      color: theme.foreground,
      backgroundColor: theme.fill,
      borderColor: "transparent",
    },
    codeBlock: {
      ...typography.code,
      fontWeight: String(typography.code.fontWeight),
      color: theme.foreground,
      backgroundColor: theme.fill,
      borderWidth: 0,
      borderRadius: radii.control,
      padding: spacing.md,
      syntaxColors: {
        keyword: scopes.purple.contentSecondary,
        string: scopes.green.contentSecondary,
        number: scopes.teal.contentSecondary,
        constant: scopes.teal.contentSecondary,
        comment: theme.muted,
        function: scopes.blue.contentSecondary,
        type: scopes.blue.contentSecondary,
        variable: scopes.orange.contentSecondary,
        property: scopes.blue.contentSecondary,
        tag: scopes.purple.contentSecondary,
        attribute: scopes.blue.contentSecondary,
      },
    },
    taskList: {
      checkedColor: theme.accentFill,
      checkmarkColor: theme.onAccentFill,
      borderColor: theme.interactiveTertiary,
    },
    math: {
      color: theme.foreground,
      backgroundColor: theme.fill,
      padding: spacing.sm,
    },
    inlineMath: { color: theme.foreground },
    highlight: { backgroundColor: theme.warningFill },
    thematicBreak: { color: theme.separator },
    table: {
      ...typography.body,
      ...prose,
      fontWeight: String(typography.body.fontWeight),
      color: theme.foreground,
      borderColor: theme.separator,
      headerBackgroundColor: theme.raised,
      headerTextColor: theme.foreground,
      rowEvenBackgroundColor: theme.surface,
      rowOddBackgroundColor: theme.canvas,
      horizontalOverflow: conversation.textInset,
    },
  };
}
