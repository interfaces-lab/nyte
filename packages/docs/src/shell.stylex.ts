import * as stylex from "@stylexjs/stylex";
import { colorVars, fontVars } from "@nyte-ai/ui/platform-tokens.stylex";

/*
 * Tailwind `min-h-svh` is `min-height: 100svh`. The small viewport is the
 * stable chrome height, so the shell does not jump when mobile toolbars show.
 * `height: 100dvh` covers the visible window; `min-height: 100svh` is the
 * Tailwind `min-h-svh` floor so the shell does not jump when toolbars show.
 */
export const shell = stylex.create({
  page: {
    display: "flex",
    flexDirection: "column",
    minHeight: "100svh",
    height: "100dvh",
    overflow: "hidden",
    backgroundColor: colorVars["--nyte-color-background"],
    color: colorVars["--nyte-color-foreground"],
    fontFamily: fontVars["--nyte-font-family-ui"],
  },
  bar: {
    flexShrink: 0,
  },
  fill: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    minWidth: 0,
  },
  fillLock: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
  },
  fillScroll: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    minHeight: 0,
    overflowY: "auto",
  },
  column: {
    height: "100%",
    minWidth: 0,
    minHeight: 0,
    overflowY: "auto",
    overscrollBehavior: "contain",
    scrollPaddingBottom: 72,
  },
  columnWrap: {
    position: "relative",
    minWidth: 0,
    minHeight: 0,
    height: "100%",
    overflow: "hidden",
  },
  columnCover: {
    position: "absolute",
    insetInline: 0,
    bottom: 0,
    height: 72,
    pointerEvents: "none",
    backgroundImage:
      "linear-gradient(to top, var(--nyte-color-background) 0%, var(--nyte-color-background) 12px, transparent 100%)",
  },
});

export function withShell(className: string, props: ReturnType<typeof stylex.props>) {
  return {
    className: [className, props.className].filter(Boolean).join(" "),
    style: props.style,
  };
}

/*
 * The doc sections are one shell with two skins. Components derive their
 * element classes from the skin name (`${skin}-side`, `${skin}-code`), so a
 * section's stylesheet is the only thing that distinguishes it.
 */
export type ShellSkin = "docs" | "cloud";
