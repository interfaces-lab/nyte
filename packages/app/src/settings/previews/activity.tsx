import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { appearance, role, shadow, type } from "@nyte-ai/ui/styles/vars.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { create, props } from "@stylexjs/stylex";
import { use, type ReactElement } from "react";
import { AppIcon } from "../../components/app-icon.ts";
import { WorkspaceRow } from "../../sidebar/sidebar-lists.tsx";
import { SessionRowView } from "../../sidebar/sidebar-rows.tsx";
import { sidebarStyles } from "../../sidebar/sidebar.stylex.ts";
import { sidebar } from "../../theme/schema.stylex.ts";
import { PREVIEW_PATH, previewChat } from "./fixtures.ts";

const ASKING = "Fix flaky login test";

/**
 * What you see when a chat needs you: the sidebar's own rows, the app's icon in the Dock with
 * its badge, and the system notification. A channel that's off leaves the picture.
 */
export function ActivityPreview({
  notification,
  badge,
  dock,
}: {
  readonly notification: boolean;
  readonly badge: boolean;
  readonly dock: boolean;
}): ReactElement {
  const icon = use(AppIcon);

  return (
    <div {...props(styles.scene)}>
      <div {...props(styles.sidebar)}>
        <WorkspaceRow
          name="nyte"
          path={PREVIEW_PATH}
          available
          active
          expanded
          onExpandedChange={() => undefined}
          onNewChat={undefined}
          onArchiveAll={undefined}
          onRemove={() => undefined}
        >
          <div {...props(sidebarStyles.section)}>
            <SessionRowView
              session={previewChat("asking", ASKING, 60_000)}
              selected={false}
              draggable={false}
              unreachable={false}
              showUpdated
              mark="waiting"
              unread={false}
              ask={undefined}
            />
            <SessionRowView
              session={previewChat("notes", "Update release notes", 3 * 3_600_000)}
              selected={false}
              draggable={false}
              unreachable={false}
              showUpdated
              mark="done"
              unread={false}
              ask={undefined}
            />
          </div>
        </WorkspaceRow>
      </div>
      <div {...props(styles.desktop)}>
        {notification && (
          <div {...props(styles.banner)}>
            {icon !== undefined && <img src={icon} alt="" {...props(styles.bannerIcon)} />}
            <span {...props(styles.bannerCopy)}>
              <span {...props(text.baseCompact, styles.bannerLine, styles.bannerTitle)}>
                {ASKING}
              </span>
              <span {...props(text.baseCompact, styles.bannerLine)}>Needs your answer</span>
            </span>
            <span {...props(text.sm, styles.bannerTime)}>now</span>
          </div>
        )}
        {dock && (
          <div {...props(styles.dock)}>
            <span {...props(styles.dockItem)}>
              {icon !== undefined && <img src={icon} alt="" {...props(styles.dockIcon)} />}
              {badge && <span {...props(text.baseCompact, intent.danger, styles.badge)}>1</span>}
              <span {...props(styles.running)} />
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/** macOS draws the banner, the Dock and its badge in its own font, not the app's. */
const SYSTEM_FONT = "system-ui";

const styles = create({
  scene: {
    display: "flex",
    alignItems: "stretch",
    height: 176,
    backgroundColor: role.windowWash,
  },
  sidebar: {
    display: "flex",
    flexDirection: "column",
    width: 208,
    flexShrink: 0,
    padding: sidebar.gutter,
    backgroundImage: `linear-gradient(${role.sidebarMaterial}, ${role.sidebarMaterial})`,
    boxShadow: `1px 0 0 ${role.strokeQuaternary}`,
  },
  desktop: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-end",
    flex: 1,
    minWidth: 0,
    padding: space.s3,
    fontFamily: SYSTEM_FONT,
  },
  banner: {
    position: "absolute",
    insetBlockStart: space.s3,
    insetInlineEnd: space.s3,
    display: "flex",
    alignItems: "center",
    gap: space.s2_5,
    width: 320,
    maxWidth: `calc(100% - 2 * ${space.s3})`,
    boxSizing: "border-box",
    paddingBlock: space.s2_5,
    paddingInlineStart: space.s2_5,
    paddingInlineEnd: space.s3,
    borderRadius: radius.surface,
    backgroundColor: role.popupMaterial,
    backdropFilter: appearance.popupMaterialFilter,
    boxShadow: `${shadow.shadowLg}, inset 0 0 0 1px ${role.strokeQuaternary}`,
    color: role.contentPrimary,
  },
  bannerIcon: { width: 40, height: 40, flexShrink: 0 },
  bannerCopy: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0 },
  bannerLine: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  bannerTitle: { fontWeight: type.weightSemibold },
  bannerTime: { alignSelf: "flex-start", flexShrink: 0, color: role.contentSecondary },
  dock: {
    display: "flex",
    paddingBlock: space.s1,
    paddingInline: space.s2,
    borderRadius: radius.surface,
    backgroundColor: role.popupMaterial,
    backdropFilter: appearance.popupMaterialFilter,
    boxShadow: `${shadow.shadowSm}, inset 0 0 0 1px ${role.strokeQuaternary}`,
  },
  dockItem: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
  dockIcon: { display: "block", width: 64, height: 64 },
  badge: {
    position: "absolute",
    insetBlockStart: space.s0_5,
    insetInlineEnd: space.s0_5,
    minWidth: space.s5,
    paddingBlock: space.px,
    paddingInline: space.s1_5,
    boxSizing: "border-box",
    borderRadius: radius.pill,
    backgroundColor: role.bgInteractiveStrong,
    color: role.contentOnInteractiveStrong,
    boxShadow: shadow.shadowSm,
    fontWeight: type.weightMedium,
    textAlign: "center",
  },
  running: {
    width: space.s1,
    height: space.s1,
    marginBlockStart: space.px,
    borderRadius: radius.pill,
    backgroundColor: role.contentSecondary,
  },
});
