/**
 * Chrome around the frame. A fixed dark surface, not the product theme.
 *
 * Radii are concentric throughout: an inner radius plus its padding equals the
 * outer one, so nested corners stay parallel.
 */
import * as stylex from "@stylexjs/stylex";

const ink = "#e8e9ec";
const dim = "#9a9ea8";
const faint = "#6f737d";
const line = "#35383f";
const panel = "#24262b";
const raised = "#2b2e34";
const live = "#62d39a";

/* Interactive state changes transition; nothing uses `all`. */
const press = {
  transitionProperty: "scale, background-color, border-color, color",
  transitionDuration: "120ms",
  transitionTimingFunction: "cubic-bezier(0.2, 0, 0, 1)",
  scale: { default: 1, ":active": 0.96 },
} as const;

export const lab = stylex.create({
  page: {
    minHeight: "100%",
    padding: { default: "28px 24px 72px", "@media (max-width: 900px)": "20px 16px 48px" },
    backgroundColor: "#1b1d21",
    backgroundImage:
      "radial-gradient(1100px 500px at 18% -8%, #2f3a4d 0%, transparent 60%), radial-gradient(900px 500px at 92% 8%, #3a2f45 0%, transparent 55%)",
    color: ink,
    fontSize: 13,
    lineHeight: 1.55,
    fontVariantNumeric: "tabular-nums",
    WebkitFontSmoothing: "antialiased",
    MozOsxFontSmoothing: "grayscale",
  },
  header: { maxWidth: "88ch", marginBottom: 18 },
  heading: {
    margin: "0 0 6px",
    fontSize: 19,
    fontWeight: 600,
    letterSpacing: "-0.015em",
    textWrap: "balance",
  },
  lede: { margin: 0, color: dim, textWrap: "pretty" },

  controls: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "14px 26px",
    padding: 12,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: line,
    borderRadius: 14,
    backgroundColor: panel,
  },
  control: { display: "flex", alignItems: "center", gap: 8 },
  checkbox: { cursor: "pointer" },
  controlLabel: { color: dim, fontSize: 12, whiteSpace: "nowrap" },

  /* Outer 14 − 4 padding = 10 inner, so the segments nest concentrically. */
  segmented: { display: "flex", gap: 2, padding: 2, borderRadius: 10, backgroundColor: raised },
  segment: {
    position: "relative",
    padding: "4px 10px",
    borderStyle: "none",
    borderRadius: 8,
    backgroundColor: { default: "transparent", ":hover": "#ffffff0f" },
    color: { default: dim, ":hover": ink },
    fontSize: 12,
    cursor: "pointer",
    ...press,
    /* A 28px control keeps a 40px target without moving the pixels. */
    "::after": {
      content: '""',
      position: "absolute",
      insetBlock: -6,
      insetInline: 0,
    },
  },
  segmentOn: {
    backgroundColor: { default: "#ffffff1a", ":hover": "#ffffff24" },
    color: ink,
  },

  desk: {
    minWidth: 0,
    marginTop: 18,
    padding: { default: 40, "@media (max-width: 900px)": 16 },
    borderRadius: 18,
    overflowX: "auto",
  },
  deskPhoto: {
    backgroundImage:
      "radial-gradient(1200px 600px at 20% 0%, #8fb7d9 0%, transparent 60%), radial-gradient(900px 700px at 85% 90%, #e0a06a 0%, transparent 55%), linear-gradient(160deg, #35507a, #6b4a72 45%, #b5744f)",
  },
  deskGrid: {
    backgroundColor: "#2b3040",
    backgroundImage:
      "repeating-linear-gradient(0deg, #ffffff12 0 1px, transparent 1px 28px), repeating-linear-gradient(90deg, #ffffff12 0 1px, transparent 1px 28px)",
  },
  deskFlat: { backgroundColor: "#3a3d44" },
  deskInner: { minWidth: 880 },

  notes: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
    gap: 14,
    margin: "24px 0 0",
    padding: 0,
    listStyle: "none",
  },
  note: {
    padding: 14,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: line,
    borderLeftWidth: 2,
    borderLeftColor: live,
    borderRadius: 10,
    backgroundColor: panel,
    color: dim,
    fontSize: 12,
    textWrap: "pretty",
  },
});

/*
 * The comparison table. One grid template shared by the head and every row so
 * the columns cannot drift, and the note wraps under the choices on narrow
 * viewports instead of being hidden.
 */
const COLUMNS = {
  default: "132px minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.3fr)",
  "@media (max-width: 1100px)": "120px minmax(0, 1fr) minmax(0, 1fr)",
} as const;

export const table = stylex.create({
  root: {
    marginTop: 24,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: line,
    borderRadius: 14,
    backgroundColor: panel,
    overflow: "hidden",
  },
  header: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
    padding: "12px 14px",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: line,
  },
  title: { margin: 0, fontSize: 13, fontWeight: 600 },
  count: { margin: 0, color: faint, fontSize: 12 },
  bulk: {
    marginLeft: "auto",
    display: "flex",
    gap: 2,
    padding: 2,
    borderRadius: 10,
    backgroundColor: raised,
  },
  bulkButton: {
    padding: "4px 10px",
    borderStyle: "none",
    borderRadius: 8,
    backgroundColor: { default: "transparent", ":hover": "#ffffff14" },
    color: { default: dim, ":hover": ink },
    fontSize: 12,
    cursor: "pointer",
    ...press,
  },

  head: {
    display: "grid",
    gridTemplateColumns: COLUMNS,
    gap: 10,
    padding: "8px 14px",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: line,
    color: faint,
    fontSize: 10.5,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
  },
  list: { margin: 0, padding: 0, listStyle: "none" },
  row: {
    display: "grid",
    gridTemplateColumns: COLUMNS,
    alignItems: "center",
    gap: 10,
    padding: "5px 14px",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: "#2f3238",
  },
  role: {
    minWidth: 0,
    color: ink,
    fontSize: 12,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  note: {
    margin: 0,
    minWidth: 0,
    color: faint,
    fontSize: 11,
    lineHeight: 1.4,
    textWrap: "pretty",
    gridColumn: { default: "auto", "@media (max-width: 1100px)": "2 / -1" },
  },

  choice: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    minWidth: 0,
    height: 30,
    paddingInline: 8,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: { default: "#ffffff0f", ":hover": "#ffffff26" },
    borderRadius: 8,
    backgroundColor: { default: "transparent", ":hover": "#ffffff0a" },
    color: dim,
    textAlign: "left",
    cursor: "pointer",
    ...press,
  },
  choiceOn: {
    borderColor: { default: live, ":hover": live },
    backgroundColor: {
      default: "color-mix(in srgb, #62d39a 14%, transparent)",
      ":hover": "color-mix(in srgb, #62d39a 20%, transparent)",
    },
    color: ink,
  },
  value: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
    fontSize: 10.5,
  },
  /* Pure white at low alpha, never a tinted neutral: a tint reads as dirt. */
  swatch: {
    width: 16,
    height: 16,
    flexShrink: 0,
    borderRadius: 5,
    outlineWidth: 1,
    outlineStyle: "solid",
    outlineColor: "oklch(1 0 0 / 0.1)",
    outlineOffset: -1,
  },
  shadowChip: {
    width: 16,
    height: 16,
    flexShrink: 0,
    borderRadius: 5,
    backgroundColor: "#f2f2f2",
  },
  weight: {
    flexShrink: 0,
    color: ink,
    fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
    fontSize: 11,
    fontVariantNumeric: "tabular-nums",
  },
});
