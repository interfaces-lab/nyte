import type { ComponentType } from "react";

export const PAGE_GLYPH_NAMES = [
  "IconAgent",
  "IconArrowsRepeat",
  "IconBookSimple",
  "IconBridge",
  "IconChart1",
  "IconCodeBrackets",
  "IconComponents",
  "IconConsole",
  "IconFinderFace",
  "IconHammer",
  "IconLayersThree",
  "IconPackage",
  "IconPlan",
  "IconPlugin1",
  "IconRocket",
  "IconSettingsGear1",
  "IconShieldCheck",
  "IconSparkle",
  "IconStorage",
  "IconStreaming",
] as const;

export const DOCS_GLYPH_NAMES = [
  ...PAGE_GLYPH_NAMES,
  "IconArrowDown",
  "IconBarsTwo",
  "IconCheckmark1Small",
  "IconClipboard",
  "IconCrossSmall",
  "IconImac",
  "IconMagnifyingGlass",
  "IconMoon",
  "IconSun",
] as const;

export type PageGlyphName = (typeof PAGE_GLYPH_NAMES)[number];

export type DocsGlyphName = (typeof DOCS_GLYPH_NAMES)[number];

export type DocsGlyph = ComponentType<{ readonly size?: number | string }>;
