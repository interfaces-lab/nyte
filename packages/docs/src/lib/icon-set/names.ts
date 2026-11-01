import type { ComponentType } from "react";

/** The page glyphs, named by their Central export as frontmatter and meta.json write them. */
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

/** Every glyph the docs site draws. Both sets map exactly these; the icons test checks Lucide. */
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
