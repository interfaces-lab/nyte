import { radius } from "@nyte-ai/ui/schema.stylex";
import { create } from "@stylexjs/stylex";
import { settings } from "./schema.stylex.ts";
import { role, type } from "@nyte-ai/ui/vars.stylex";

export const settingsPatterns = create({
  pageTitle: {
    margin: 0,
    color: role.contentPrimary,
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
    gap: 4,
    paddingInline: 4,
  },
  sectionTitle: {
    margin: 0,
    color: role.contentPrimary,
    fontSize: settings.sectionTitleSize,
    fontWeight: 500,
    lineHeight: settings.sectionTitleLineHeight,
  },
  sectionDescription: {
    margin: 0,
    color: role.contentSecondary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
  },
  group: {
    display: "flex",
    flexDirection: "column",
    overflow: "clip",
    borderRadius: radius.card,
    backgroundColor: role.bgMutedTranslucent,
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
    padding: settings.rowPadding,
    "::before": {
      position: "absolute",
      insetInline: settings.rowPaddingInline,
      insetBlockStart: 0,
      height: 1,
      backgroundColor: role.borderSecondaryTranslucent,
      content: '""',
    },
    ":first-child::before": { display: "none" },
  },
  rowDetailed: { rowGap: 8 },
  rowCopy: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    width: {
      default: "auto",
      "@media (max-width: 500px)": "100%",
      "@container (max-width: 500px)": "100%",
    },
    minWidth: 0,
    maxWidth: "100%",
    overflow: "clip",
    flex: {
      default: "1 1 0",
      "@media (max-width: 500px)": "0 0 auto",
      "@container (max-width: 500px)": "0 0 auto",
    },
  },
  rowTitle: {
    overflow: "hidden",
    color: role.contentPrimary,
    fontSize: type.fontBase,
    fontWeight: 400,
    lineHeight: type.leadingBase,
    letterSpacing: type.letterBase,
    textOverflow: "ellipsis",
  },
  rowDescription: {
    color: role.contentSecondary,
    fontSize: type.fontBase,
    fontWeight: 400,
    lineHeight: type.leadingBase,
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
