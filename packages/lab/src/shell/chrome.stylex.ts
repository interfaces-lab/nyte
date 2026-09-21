import * as stylex from "@stylexjs/stylex";
import { radius } from "../tokens/layer.stylex";

/*
 * The page around the shell, and the only file in the package allowed literal
 * values. It is the viewer, not the system under test: if the control strip
 * read as product UI you could not tell which surfaces the tokens were
 * responsible for. So it is deliberately foreign, near-monochrome, and the same
 * in both appearances.
 *
 * It sets no backdrop-filter. The contract reserves that for the material, and
 * a blurred control strip would sit in the same test as the thing being tested.
 *
 * `radius` from area A is the one token borrowed here, because the window's
 * corner has to match the shell's corner exactly or the clip shows at the edge.
 */

export const chrome = stylex.create({
  page: {
    position: "fixed",
    inset: 0,
    display: "grid",
    placeItems: "center",
    overflow: "hidden",
    fontFamily: "'Inter Variable', Inter, sans-serif",
  },

  pageInspecting: { paddingInlineEnd: { default: 464, "@media (max-width: 980px)": 0 } },
  backdrop: {
    position: "absolute",
    inset: 0,
  },
  // Photographic enough to flatter a blur, which is why it is not the default.
  photo: {
    backgroundColor: "#243040",
    backgroundImage: [
      "radial-gradient(70% 90% at 12% 8%, rgba(255,184,112,0.90), rgba(255,184,112,0) 62%)",
      "radial-gradient(60% 70% at 88% 18%, rgba(120,190,255,0.75), rgba(120,190,255,0) 58%)",
      "radial-gradient(90% 80% at 70% 96%, rgba(255,110,150,0.55), rgba(255,110,150,0) 60%)",
      "linear-gradient(160deg, #3a2a55 0%, #1c2a3c 52%, #123037 100%)",
    ].join(", "),
  },
  // The honest test. Straight lines stay straight through a fill and bend
  // through a blur, so a material that is only a tint has nowhere to hide.
  grid: {
    backgroundColor: "#d7d8da",
    backgroundImage: [
      "repeating-linear-gradient(0deg, rgba(10,12,20,0.55) 0 1px, rgba(10,12,20,0) 1px 16px)",
      "repeating-linear-gradient(90deg, rgba(10,12,20,0.55) 0 1px, rgba(10,12,20,0) 1px 16px)",
      "repeating-linear-gradient(0deg, rgba(10,12,20,0.35) 0 1px, rgba(10,12,20,0) 1px 96px)",
      "repeating-linear-gradient(90deg, rgba(10,12,20,0.35) 0 1px, rgba(10,12,20,0) 1px 96px)",
    ].join(", "),
  },
  flat: {
    backgroundColor: "#2b2b2b",
  },

  // The drop shadow belongs to the photograph of a window, not to the layer
  // scale. A shell in a real desktop has the compositor draw this.
  stage: {
    position: "relative",
    // The window leaves room for the strip rather than sitting under it. Both
    // numbers are the viewer's framing, not the shell's layout.
    inlineSize: "min(1600px, calc(100% - 32px))",
    blockSize: "min(900px, calc(100vh - 120px))",
    overflow: "hidden",
    borderRadius: radius.r12,
    boxShadow: "0 40px 90px -20px rgba(0,0,0,0.55), 0 8px 24px -8px rgba(0,0,0,0.35)",
  },

  // Deliberately outside the layer scale. The scale tops out at the dialog, and
  // the controls have to stay reachable above whatever the dialog puts on
  // screen, so this number is the viewer's and not the system's.
  strip: {
    position: "fixed",
    zIndex: 1000,
    insetBlockEnd: 20,
    insetInlineStart: "50%",
    transform: "translateX(-50%)",
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    inlineSize: "max-content",
    maxInlineSize: "calc(100vw - 24px)",
    gap: {
      default: 18,
      "@media (max-width: 700px)": 8,
    },
    paddingInline: {
      default: 12,
      "@media (max-width: 700px)": 6,
    },
    paddingBlock: 8,
    borderRadius: 14,
    backgroundColor: "rgba(16,16,18,0.88)",
    boxShadow: "0 8px 24px -8px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(255,255,255,0.10)",
    color: "rgba(255,255,255,0.72)",
    fontSize: 11,
    lineHeight: "16px",
    WebkitFontSmoothing: "antialiased",
  },
  surfaceSelect: {
    minBlockSize: 28,
    paddingInline: 6,
    border: "1px solid #ffffff26",
    borderRadius: 6,
    backgroundColor: "#252528",
    color: "#eeeeee",
    font: "inherit",
    colorScheme: "dark",
  },
  field: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  legend: {
    display: {
      default: "inline",
      "@media (max-width: 700px)": "none",
    },
    color: "rgba(255,255,255,0.40)",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
  },
  segments: {
    display: {
      default: "flex",
      "@media (max-width: 700px)": "none",
    },
    alignItems: "center",
    gap: 2,
    padding: 2,
    borderRadius: 9,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  select: {
    display: {
      default: "none",
      "@media (max-width: 700px)": "block",
    },
    minBlockSize: 30,
    paddingInline: 8,
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 8,
    outline: {
      default: "none",
      ":focus-visible": "2px solid rgba(255,255,255,0.72)",
    },
    outlineOffset: 2,
    backgroundColor: "rgba(255,255,255,0.08)",
    color: "rgba(255,255,255,0.92)",
    colorScheme: "dark",
    fontFamily: "inherit",
    fontSize: 11,
    lineHeight: "16px",
    cursor: "default",
  },
  segment: {
    minBlockSize: 28,
    paddingInline: {
      default: 8,
      "@media (max-width: 700px)": 6,
    },
    paddingBlock: 3,
    border: "none",
    borderRadius: 7,
    outline: {
      default: "none",
      ":focus-visible": "2px solid rgba(255,255,255,0.72)",
    },
    outlineOffset: -2,
    backgroundColor: {
      default: "transparent",
      ":hover": "rgba(255,255,255,0.08)",
    },
    color: "rgba(255,255,255,0.62)",
    fontSize: 11,
    lineHeight: "16px",
    whiteSpace: "nowrap",
    cursor: "default",
  },
  segmentOn: {
    backgroundColor: {
      default: "rgba(255,255,255,0.16)",
      ":hover": "rgba(255,255,255,0.18)",
    },
    color: "rgba(255,255,255,0.96)",
  },
});
