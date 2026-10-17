/** Controls unique to Settings › Appearance. */
import { glyph, radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { create } from "@stylexjs/stylex";
import { diffView, settings } from "../theme/schema.stylex.ts";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";

export const appearanceStyles = create({
  root: { display: "flex", flexDirection: "column", gap: settings.sectionGap },
  tintControl: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s2,
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
  codeFontPreview: {
    overflow: "clip",
    borderRadius: radius.indicator,
    fontFamily: type.fontMono,
    fontSize: type.fontCode,
    lineHeight: diffView.lineHeight,
  },
  diffLine: {
    display: "grid",
    gridTemplateColumns: "32px minmax(0, 1fr)",
    paddingInlineEnd: space.s2,
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
