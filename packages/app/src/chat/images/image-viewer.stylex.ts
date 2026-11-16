import { create } from "@stylexjs/stylex";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { imageViewer } from "../../theme/schema.stylex.ts";

const compact = "@media (max-width: 640px)";

const surfaceWidth = {
  default: `min(${imageViewer.width}, 100vw - ${space.s6} * 2)`,
  [compact]: `100vw - ${space.s2} * 2`,
} as const;

export const imageViewerStyles = create({
  popup: { width: "max-content", overflow: "visible" },
  preview: { "--nyte-image-viewer-compact-footer-height": imageViewer.footerHeight },
  away: { visibility: "hidden" },
  frame: {
    position: "relative",
    translate: {
      default: `0 calc(${imageViewer.footerHeight} / -2)`,
      [compact]: `0 calc(${imageViewer.compactFooterHeight} / -2)`,
    },
  },
  previewFrame: { borderRadius: `calc(${radius.surface} - ${space.s1})` },
  surface: {
    position: "absolute",
    top: {
      default: `calc(0px - ${imageViewer.footerHeight} / 2 - ${space.s1})`,
      [compact]: `calc(0px - ${imageViewer.compactFooterHeight} / 2 - ${space.s1})`,
    },
    bottom: {
      default: `calc(0px - ${imageViewer.footerHeight} / 2 - ${space.s1})`,
      [compact]: `calc(0px - ${imageViewer.compactFooterHeight} / 2 - ${space.s1})`,
    },
    left: "50%",
    translate: "-50% 0",
    width: {
      default: `calc(${surfaceWidth.default})`,
      [compact]: `calc(${surfaceWidth[compact]})`,
    },
    borderRadius: radius.surface,
    pointerEvents: "none",
  },
  footer: {
    position: "absolute",
    top: "100%",
    left: "50%",
    translate: "-50% 0",
    width: {
      default: `calc(${surfaceWidth.default} - ${space.s1} * 2)`,
      [compact]: `calc(${surfaceWidth[compact]} - ${space.s1} * 2)`,
    },
    height: { default: imageViewer.footerHeight, [compact]: imageViewer.compactFooterHeight },
  },
  image: {
    position: "relative",
    display: "block",
    width: "auto",
    height: "auto",
    maxWidth: {
      default: `calc(${surfaceWidth.default} - ${space.s1} * 2)`,
      [compact]: `calc(${surfaceWidth[compact]} - ${space.s1} * 2)`,
    },
    maxHeight: {
      default: `calc(100dvh - ${space.s6} * 2 - ${space.s1} * 2 - ${imageViewer.footerHeight})`,
      [compact]: `calc(100dvh - ${space.s2} * 2 - ${space.s1} * 2 - ${imageViewer.compactFooterHeight})`,
    },
    borderRadius: `calc(${radius.surface} - ${space.s1})`,
    objectFit: "contain",
    userSelect: "none",
  },
  drawn: { visibility: "hidden" },
});
