import { css } from "react-strict-dom";
import type { MarkdownStyle } from "react-native-enriched-markdown";
import { platformColors } from "@nyte-ai/ui/platform-colors";

// The app is dark-only. Raw colors also serve native controls outside RSD.
export const nativeTheme = {
  background: platformColors.dark.sidebar,
  surface: platformColors.dark.background,
  raised: platformColors.dark.fieldBackground,
  foreground: platformColors.dark.foreground,
  muted: platformColors.dark.mutedForeground,
  border: platformColors.dark.borderWeak,
  accent: platformColors.dark.accent,
  success: platformColors.dark.success,
  danger: platformColors.dark.destructive,
  warning: platformColors.dark.warning,
};

export const tokens = css.defineVars(nativeTheme);

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radii = { sm: 8, control: 14, card: 16, bubble: 20, pill: 999 };
export const controls = {
  borderWidth: 1,
  statusDot: 6,
  touchTarget: 44,
  metaTarget: 28,
  primaryHeight: 52,
  iconXs: 13,
  iconSm: 16,
  icon: 20,
  iconWeight: "semibold",
  composerMaxHeight: 140,
  disabledOpacity: 0.56,
} as const;

export const conversation = {
  contentMaxWidth: 768,
  gutter: spacing.md,
  textInset: spacing.lg,
};

export const media = {
  attachmentSize: 88,
  thumbnailWidth: 180,
  thumbnailHeight: 140,
  bubbleMaxWidthRatio: 0.85,
  deviceTileSize: 88,
  deviceTileRadius: 24,
  macSymbol: 40,
  phoneSymbol: 34,
} as const;

export const typography = {
  body: { fontSize: 16, lineHeight: 24, fontWeight: 400 },
  secondary: { fontSize: 15, lineHeight: 20, fontWeight: 400 },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: 400 },
  label: { fontSize: 13, lineHeight: 18, fontWeight: 500 },
  title: { fontSize: 17, lineHeight: 22, fontWeight: 600 },
  heading: { fontSize: 28, lineHeight: 34, fontWeight: 600 },
  error: { fontSize: 14, lineHeight: 20, fontWeight: 400 },
  code: { fontSize: 14, lineHeight: 20, fontWeight: 400, fontFamily: "Menlo" },
  section: { fontSize: 20, lineHeight: 26, fontWeight: 600 },
} as const;

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
  code: {
    ...typography.code,
    lineHeight: `${typography.code.lineHeight}px`,
    color: tokens.foreground,
  },
});

export const markdownStyle = {
  paragraph: {
    ...typography.body,
    fontWeight: String(typography.body.fontWeight),
    color: nativeTheme.foreground,
  },
  h1: {
    ...typography.heading,
    fontWeight: String(typography.heading.fontWeight),
    color: nativeTheme.foreground,
  },
  h2: {
    ...typography.section,
    fontWeight: String(typography.section.fontWeight),
    color: nativeTheme.foreground,
  },
  h3: {
    ...typography.title,
    fontWeight: String(typography.title.fontWeight),
    color: nativeTheme.foreground,
  },
  h4: {
    ...typography.title,
    fontWeight: String(typography.title.fontWeight),
    color: nativeTheme.foreground,
  },
  h5: {
    ...typography.body,
    fontWeight: String(typography.title.fontWeight),
    color: nativeTheme.foreground,
  },
  h6: {
    ...typography.body,
    fontWeight: String(typography.title.fontWeight),
    color: nativeTheme.muted,
  },
  strong: { color: nativeTheme.foreground },
  em: { color: nativeTheme.foreground },
  link: { color: nativeTheme.accent, underline: true },
  list: {
    ...typography.body,
    fontWeight: String(typography.body.fontWeight),
    color: nativeTheme.foreground,
    bulletColor: nativeTheme.muted,
    markerColor: nativeTheme.muted,
  },
  blockquote: {
    ...typography.body,
    fontWeight: String(typography.body.fontWeight),
    color: nativeTheme.muted,
    borderColor: nativeTheme.border,
  },
  code: {
    fontSize: typography.code.fontSize,
    fontFamily: typography.code.fontFamily,
    color: nativeTheme.foreground,
    backgroundColor: nativeTheme.raised,
  },
  codeBlock: {
    ...typography.code,
    fontWeight: String(typography.code.fontWeight),
    color: nativeTheme.foreground,
    backgroundColor: nativeTheme.surface,
    borderColor: nativeTheme.border,
    borderRadius: radii.sm,
    padding: spacing.md,
  },
  thematicBreak: { color: nativeTheme.border },
  table: {
    ...typography.body,
    fontWeight: String(typography.body.fontWeight),
    color: nativeTheme.foreground,
    borderColor: nativeTheme.border,
    headerBackgroundColor: nativeTheme.raised,
    headerTextColor: nativeTheme.foreground,
    rowEvenBackgroundColor: nativeTheme.surface,
    rowOddBackgroundColor: nativeTheme.background,
  },
} satisfies MarkdownStyle;
