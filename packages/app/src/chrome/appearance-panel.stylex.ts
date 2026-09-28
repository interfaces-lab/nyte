/** Controls unique to Settings › Appearance. */
import * as stylex from "@stylexjs/stylex";
import { settings } from "../theme/schema.stylex.ts";
import { t } from "@nyte-ai/ui/vars.stylex";

export const appearancePanelStyles = stylex.create({
  root: { display: "flex", flexDirection: "column", gap: settings.sectionGap },
  tintControl: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    width: 150,
  },
  tintSlider: { width: 120, minWidth: 0, flex: "0 1 auto" },
  tintThumb: {
    backgroundColor: t.tintSwatch,
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
    borderColor: t.imageOutline,
    borderRadius: t.radiusFull,
    backgroundColor: t.fillStrong,
  },
  tintSwatchActive: {
    backgroundColor: t.tintSwatch,
  },
  tintValue: {
    color: t.textSecondary,
    fontSize: t.fontXs,
    lineHeight: t.leadingSm,
    textAlign: "center",
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
    borderRadius: t.radiusFull,
    backgroundColor: t.iconTertiary,
    pointerEvents: "none",
    transform: "translate(-50%, -50%)",
  },
  densityLabels: {
    display: "flex",
    justifyContent: "space-between",
    marginTop: 4,
    color: t.textTertiary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
  },
  codeFontPreview: {
    overflow: "hidden",
    borderRadius: t.radiusSm,
    fontFamily: t.fontMono,
    fontSize: t.fontCode,
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
    borderInlineStart: `3px solid ${t.diffRemoved}`,
    backgroundColor: t.diffRemovedLineBg,
  },
  diffAddedLine: {
    borderInlineStart: `3px solid ${t.diffAdded}`,
    backgroundColor: t.diffAddedLineBg,
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
  diffRemovedNumber: { color: t.diffRemoved, textAlign: "center" },
  diffAddedNumber: { color: t.diffAdded, textAlign: "center" },
  codeKeyword: { color: t.textDanger },
  codeIdentifier: { color: t.textAccent },
});
