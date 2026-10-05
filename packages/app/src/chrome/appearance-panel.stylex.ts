import { glyph, radius } from "@nyte-ai/ui/schema.stylex";
/** Controls unique to Settings › Appearance. */
import { create } from "@stylexjs/stylex";
import { diffView, settings } from "../theme/schema.stylex.ts";
import { role, type } from "@nyte-ai/ui/vars.stylex";

export const appearancePanelStyles = create({
  root: { display: "flex", flexDirection: "column", gap: settings.sectionGap },
  tintControl: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  },
  tintSlider: { width: 120, minWidth: 0, flex: "0 1 auto" },
  tintSlot: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: glyph.lg,
    flexShrink: 0,
  },
  tintSwatch: {
    display: "block",
    width: glyph.lg,
    height: glyph.lg,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: role.borderPrimaryTranslucent,
    borderRadius: radius.pill,
    backgroundColor: role.bgInteractivePrimaryTranslucent,
  },
  tintSwatchActive: {
    backgroundColor: role.bgInteractiveStrong,
  },
  density: {
    display: "flex",
    flexDirection: "column",
    width: {
      default: 150,
      "@media (max-width: 500px)": "100%",
      "@container (max-width: 500px)": "100%",
    },
    minWidth: 0,
    maxWidth: "100%",
    boxSizing: "border-box",
  },
  densitySlider: {
    width: "100%",
    paddingBlock: 8,
  },
  densityLabels: {
    display: "flex",
    justifyContent: "space-between",
    marginTop: 4,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  codeFontPreview: {
    overflow: "hidden",
    borderRadius: radius.indicator,
    fontFamily: type.fontMono,
    fontSize: type.fontCode,
    lineHeight: diffView.lineHeight,
  },
  diffLine: {
    display: "grid",
    gridTemplateColumns: "32px minmax(0, 1fr)",
    paddingInlineEnd: 8,
    whiteSpace: "pre",
  },
  diffRemovedLine: {
    borderInlineStartWidth: 3,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: role.contentInteractiveTertiary,
    backgroundColor: role.bgInteractiveSecondaryTranslucent,
  },
  diffAddedLine: {
    borderInlineStartWidth: 3,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: role.contentInteractiveTertiary,
    backgroundColor: role.bgInteractiveSecondaryTranslucent,
  },
  codePreviewText: {
    display: "block",
    minWidth: 0,
    overflow: "hidden",
    fontFamily: "inherit",
    fontSize: "inherit",
    lineHeight: "inherit",
    textOverflow: "ellipsis",
    whiteSpace: "pre",
  },
  diffRemovedNumber: { color: role.contentSecondary, textAlign: "center" },
  diffAddedNumber: { color: role.contentSecondary, textAlign: "center" },
  codeKeyword: { color: role.contentSecondary },
  codeIdentifier: { color: role.contentSecondary },
});
