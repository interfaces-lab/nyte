import { create } from "@stylexjs/stylex";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { imageViewer } from "../../theme/schema.stylex.ts";

const compact = "@media (max-width: 640px)";

export const imageViewerStyles = create({
  popup: { width: "max-content", overflow: "visible" },
  frame: { position: "relative" },
  surface: {
    position: "absolute",
    top: `calc(0px - ${imageViewer.headerHeight} - ${space.s2})`,
    bottom: {
      default: `calc(0px - ${imageViewer.footerHeight} - ${space.s2})`,
      [compact]: `calc(0px - ${imageViewer.compactFooterHeight} - ${space.s2})`,
    },
    left: "50%",
    translate: "-50% 0",
    width: {
      default: `min(${imageViewer.width}, calc(100vw - ${space.s6} * 2))`,
      [compact]: `calc(100vw - ${space.s2} * 2)`,
    },
    borderRadius: radius.surface,
    pointerEvents: "none",
  },
  header: {
    position: "absolute",
    bottom: "100%",
    left: "50%",
    translate: "-50% 0",
    width: {
      default: `calc(min(${imageViewer.width}, 100vw - ${space.s6} * 2) - ${space.s2} * 2)`,
      [compact]: `calc(100vw - ${space.s2} * 4)`,
    },
  },
  close: {
    position: "absolute",
    zIndex: 1,
    bottom: "100%",
    height: imageViewer.headerHeight,
    display: "flex",
    alignItems: "center",
    insetInlineEnd: {
      default: `calc((100% - min(${imageViewer.width}, 100vw - ${space.s6} * 2)) / 2 + ${space.s4})`,
      [compact]: `calc((100% - (100vw - ${space.s2} * 2)) / 2 + ${space.s4})`,
    },
  },
  footer: {
    position: "absolute",
    top: "100%",
    left: "50%",
    translate: "-50% 0",
    width: {
      default: `calc(min(${imageViewer.width}, 100vw - ${space.s6} * 2) - ${space.s2} * 2)`,
      [compact]: `calc(100vw - ${space.s2} * 4)`,
    },
  },
  image: {
    position: "relative",
    display: "block",
    width: "auto",
    height: "auto",
    maxWidth: {
      default: `calc(min(${imageViewer.width}, 100vw - ${space.s6} * 2) - ${space.s2} * 2)`,
      [compact]: `calc(100vw - ${space.s2} * 4)`,
    },
    maxHeight: {
      default: `calc(100dvh - ${space.s6} * 2 - ${space.s2} * 2 - ${imageViewer.headerHeight} - ${imageViewer.footerHeight})`,
      [compact]: `calc(100dvh - ${space.s2} * 4 - ${imageViewer.headerHeight} - ${imageViewer.compactFooterHeight})`,
    },
    borderRadius: radius.control,
    objectFit: "contain",
    userSelect: "none",
  },
});
