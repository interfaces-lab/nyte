import * as stylex from "@stylexjs/stylex";

export const cta = stylex.create({
  base: {
    height: 44,
    paddingInline: 20,
    gap: 8,
    borderRadius: 999,
    fontSize: 15,
  },
  solid: {
    backgroundColor: {
      default: "#fff",
      ":hover": { "@media (hover: hover)": "rgba(255,255,255,0.86)" },
    },
    color: "var(--hero-blue)",
  },
  quiet: {
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover)": "rgba(255,255,255,0.12)" },
    },
    color: {
      default: "rgba(255,255,255,0.72)",
      ":hover": { "@media (hover: hover)": "#fff" },
    },
  },
});

/*
 * One scale, every step a multiple of 4: 16 inside a stack, 32 under the
 * headline, 48 between the column and the grid. StyleX compiles these at
 * build time, so they are literals rather than an imported table.
 */
export const layout = stylex.create({
  section: {
    display: "flex",
    flexDirection: { default: "column", "@media (min-width: 1024px)": "row" },
    alignItems: { default: "stretch", "@media (min-width: 1024px)": "center" },
    gap: 48,
    minHeight: "calc(100svh - var(--site-nav-height))",
    width: "min(100%, var(--site-inner))",
    marginInline: "auto",
    paddingInline: "var(--site-pad)",
    paddingBlock: { default: 48, "@media (min-width: 1024px)": 0 },
  },
  copy: {
    flexShrink: 0,
    width: { default: "100%", "@media (min-width: 1024px)": "36%" },
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 16,
    marginBlockStart: 32,
  },
  grid: {
    minWidth: 0,
    flexGrow: 1,
  },
});
