import * as stylex from "@stylexjs/stylex";
import { radius } from "../tokens/layer.stylex";

/*
 * The page around the shell, and the only file in the package allowed literal
 * values. It is the viewer, not the system under test, so it stays deliberately
 * foreign, near-monochrome, and the same in both appearances. Every control now
 * lives in DialKit's own panel; nothing here paints a widget.
 *
 * It sets no backdrop-filter. The contract reserves that for the material.
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
    // The viewer's framing, not the shell's layout.
    inlineSize: "min(1600px, calc(100% - 32px))",
    blockSize: "min(900px, calc(100vh - 120px))",
    overflow: "hidden",
    borderRadius: radius.r12,
    boxShadow: "0 40px 90px -20px rgba(0,0,0,0.55), 0 8px 24px -8px rgba(0,0,0,0.35)",
  },
});
