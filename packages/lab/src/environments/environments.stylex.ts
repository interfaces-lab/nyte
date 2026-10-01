import { shape } from "@nyte-ai/ui/schema.stylex";
import { create } from "@stylexjs/stylex";
import { role, type } from "@nyte-ai/ui/vars.stylex";

export const boardStyles = create({
  page: {
    height: "100%",
    overflowY: "auto",
    backgroundColor: role.bgBase,
    color: role.contentPrimary,
    fontFamily: type.fontSans,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    WebkitFontSmoothing: "antialiased",
  },
  header: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
    paddingInline: 32,
    paddingBlock: 20,
  },
  title: { fontSize: type.fontLg, lineHeight: type.leadingLg, fontWeight: 500 },
  subtitle: { color: role.contentSecondary, flex: 1, minWidth: 240 },
});

export const newChatStyles = create({
  frame: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: 8,
    flex: 1,
    minWidth: 0,
    width: "100%",
    maxWidth: 640,
    marginInline: "auto",
    paddingInline: 32,
  },
  context: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    minWidth: 0,
    color: role.contentSecondary,
  },
  chipText: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  chipDivider: { color: role.contentDisabled },
  staticChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    height: 28,
    paddingInline: 8,
    color: role.contentSecondary,
  },
  composer: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    minHeight: 104,
    padding: 12,
    borderRadius: shape.surface,
    backgroundColor: role.bgElevated,
    boxShadow: `0 0 0 1px ${role.borderSecondaryTranslucent}`,
    color: role.contentTertiary,
  },
  composerFoot: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    color: role.contentSecondary,
    fontSize: type.fontSm,
  },
  send: {
    display: "grid",
    placeItems: "center",
    width: 28,
    height: 28,
    borderRadius: shape.pill,
    backgroundColor: role.bgInteractivePrimaryTranslucent,
    color: role.contentInteractiveSecondary,
  },
  menuMeta: { color: role.contentSecondary, fontSize: type.fontSm },
});
