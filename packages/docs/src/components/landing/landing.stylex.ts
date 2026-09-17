import * as stylex from "@stylexjs/stylex";

/*
 * The visitor meets us, then looks at the run.
 *
 * flexCol / flexRow: the stage. A column on a phone (demo, then story). A row
 * from 1024px (demo | story), with the demo sticky under the site nav.
 *
 * hostsRow: the two windows. Stacked by default so the column can read. A row
 * only on a mid-width screen where the stage is still a column.
 */
export const landing = stylex.create({
  flexCol: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    minWidth: 0,
    width: "100%",
  },
  flexRow: {
    "@media (min-width: 1024px)": {
      flexDirection: "row",
      alignItems: "stretch",
    },
  },
  hostsRow: {
    "@media (min-width: 720px) and (max-width: 1023px)": {
      flexDirection: "row",
      alignItems: "stretch",
    },
  },
  stage: {
    gap: 32,
    "@media (min-width: 1024px)": {
      alignItems: "flex-start",
      gap: 48,
    },
  },
  demo: {
    width: "100%",
    minWidth: 0,
    "@media (min-width: 1024px)": {
      width: "58%",
      flexGrow: 1,
      flexShrink: 0,
      flexBasis: "58%",
    },
  },
  sticky: {
    "@media (min-width: 1024px)": {
      position: "sticky",
      top: "calc(var(--site-nav-height) + 16px)",
      zIndex: 1,
    },
  },
  story: {
    display: "flex",
    flexDirection: "column",
    gap: 28,
    width: "100%",
    minWidth: 0,
    "@media (min-width: 1024px)": {
      width: "38%",
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: "38%",
    },
  },
  beat: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
});
