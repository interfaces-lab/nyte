import { shape } from "@nyte-ai/ui/schema.stylex";
/** Controls unique to Settings › Appearance. */
import { create } from "@stylexjs/stylex";
import { settings } from "../theme/schema.stylex.ts";
import { role, type } from "@nyte-ai/ui/vars.stylex";

export const appearancePanelStyles = create({
  root: { display: "flex", flexDirection: "column", gap: settings.sectionGap },
  tintControl: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    width: 180,
  },
  tintSlider: { width: 120, minWidth: 0, flex: "0 1 auto" },
  tintThumb: {
    backgroundColor: role.bgInteractiveStrong,
  },
  tintSlot: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    // Wide enough for "100%"; the hue swatch centers in the same slot.
    width: 26,
    flexShrink: 0,
  },
  tintSwatch: {
    display: "block",
    width: 20,
    height: 20,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: role.borderPrimaryTranslucent,
    borderRadius: shape.pill,
    backgroundColor: role.bgInteractivePrimaryTranslucent,
  },
  tintSwatchActive: {
    backgroundColor: role.bgInteractiveStrong,
  },
  tintValue: {
    color: role.contentSecondary,
    fontSize: type.fontXs,
    lineHeight: type.leadingSm,
    textAlign: "center",
    fontVariantNumeric: "tabular-nums",
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
  densityDetent: {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: 4,
    height: 4,
    borderRadius: shape.pill,
    backgroundColor: role.contentTertiary,
    pointerEvents: "none",
    transform: "translate(-50%, -50%)",
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
    borderRadius: shape.indicator,
    fontFamily: type.fontMono,
    fontSize: type.fontCode,
    lineHeight: "20px",
  },
  diffLine: {
    display: "grid",
    gridTemplateColumns: "32px minmax(0, 1fr)",
    minHeight: 20,
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
