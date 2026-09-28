/** Shared geometry and typography for the compact Settings surface. */
import * as stylex from "@stylexjs/stylex";
import { settings } from "./schema.stylex.ts";
import { t } from "@nyte-ai/ui/vars.stylex";

export const settingsPatterns = stylex.create({
  pageTitle: {
    margin: 0,
    color: t.textPrimary,
    fontSize: settings.pageTitleSize,
    fontWeight: 500,
    lineHeight: settings.pageTitleLineHeight,
    letterSpacing: 0,
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: settings.cardGap,
  },
  sectionHeader: {
    display: "flex",
    flexDirection: "column",
    alignSelf: "stretch",
    gap: 2,
    padding: "0 4px 0 8px",
  },
  sectionTitle: {
    margin: 0,
    color: t.textSecondary,
    fontSize: t.fontSm,
    fontWeight: 400,
    lineHeight: t.leadingSm,
  },
  sectionDescription: {
    margin: 0,
    color: t.textTertiary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
  },
  group: {
    display: "flex",
    flexDirection: "column",
    overflow: "clip",
    borderRadius: t.radiusXl,
    backgroundColor: t.fillQuiet,
  },
  row: {
    position: "relative",
    display: "flex",
    flexDirection: {
      default: "row",
      "@media (max-width: 500px)": "column",
      "@container (max-width: 500px)": "column",
    },
    flexWrap: "wrap",
    alignItems: "center",
    alignSelf: "stretch",
    gap: {
      default: 20,
      "@media (max-width: 500px)": 12,
      "@container (max-width: 500px)": 12,
    },
    minHeight: settings.rowMinHeight,
    padding: settings.rowPadding,
    "::before": {
      position: "absolute",
      insetInline: settings.rowPadding,
      insetBlockStart: 0,
      height: 1,
      backgroundColor: t.strokeSecondary,
      content: '""',
    },
    ":first-child::before": { display: "none" },
  },
  rowSlider: { minHeight: settings.sliderRowMinHeight },
  rowDetailed: { rowGap: 8 },
  rowCopy: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
    width: {
      default: "auto",
      "@media (max-width: 500px)": "100%",
      "@container (max-width: 500px)": "100%",
    },
    minWidth: 0,
    maxWidth: "100%",
    overflow: "hidden",
    flex: {
      default: "1 1 0",
      "@media (max-width: 500px)": "0 0 auto",
      "@container (max-width: 500px)": "0 0 auto",
    },
  },
  rowTitle: {
    overflow: "hidden",
    color: t.textPrimary,
    fontSize: t.fontBase,
    fontWeight: 400,
    lineHeight: t.leadingBase,
    letterSpacing: t.letterBase,
    textOverflow: "ellipsis",
  },
  rowDescription: {
    color: t.textSecondary,
    fontSize: t.fontBase,
    fontWeight: 400,
    lineHeight: t.leadingBase,
    overflowWrap: "break-word",
  },
  rowControl: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: {
      default: "flex-end",
      "@media (max-width: 500px)": "flex-start",
      "@container (max-width: 500px)": "flex-start",
    },
    alignSelf: "stretch",
    width: {
      default: "auto",
      "@media (max-width: 500px)": "100%",
      "@container (max-width: 500px)": "100%",
    },
    minWidth: 0,
    maxWidth: {
      default: settings.controlMaxWidth,
      "@media (max-width: 500px)": "none",
      "@container (max-width: 500px)": "none",
    },
    flex: {
      default: "0 0 auto",
      "@media (max-width: 500px)": "1 1 100%",
      "@container (max-width: 500px)": "1 1 100%",
    },
  },
  rowControlWide: {
    maxWidth: {
      default: 280,
      "@media (max-width: 500px)": "none",
      "@container (max-width: 500px)": "none",
    },
  },
  rowDetail: {
    width: "100%",
    minWidth: 0,
    flex: "1 0 100%",
  },
});
