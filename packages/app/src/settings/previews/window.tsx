import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Row } from "@nyte-ai/ui/row";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { WorkspaceRow } from "../../sidebar/sidebar-lists.tsx";
import { ChatCardGroup } from "../../components/chat-card.tsx";
import { SessionRowView } from "../../sidebar/sidebar-rows.tsx";
import { sidebarStyles } from "../../sidebar/sidebar.stylex.ts";
import { UserMessageView } from "../../chat/transcript/turn-view.tsx";
import { conversation, shell, sidebar } from "../../theme/schema.stylex.ts";
import { PREVIEW_PATH, previewChat } from "./fixtures.ts";

const ACTIVE = previewChat("active", "Settings density", 2 * 60_000);

const OTHER = previewChat("other", "Release notes", 3 * 3_600_000);

export function WindowPreview(): ReactElement {
  return (
    <div {...props(styles.window)}>
      <div {...props(styles.sidebar)}>
        <Row variant="nav" xstyle={sidebarStyles.navRow}>
          <Row.Leading xstyle={sidebarStyles.navLeading}>
            <Icon name="new-chat" size="sm" />
          </Row.Leading>
          <Row.Label>New Chat</Row.Label>
        </Row>
        <Row variant="nav" xstyle={sidebarStyles.navRow}>
          <Row.Leading xstyle={sidebarStyles.navLeading}>
            <Icon name="search" size="sm" />
          </Row.Leading>
          <Row.Label>Search</Row.Label>
        </Row>
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
          <ChatCardGroup placement="row">
            <div {...props(sidebarStyles.section)}>
              {[ACTIVE, OTHER].map((session) => (
                <SessionRowView
                  key={session.id}
                  session={session}
                  selected={session.id === ACTIVE.id}
                  draggable={false}
                  unreachable={false}
                  showUpdated
                  mark="done"
                  unread={false}
                  ask={undefined}
                />
              ))}
            </div>
          </ChatCardGroup>
        </WorkspaceRow>
      </div>
      <div {...props(styles.card)}>
        <UserMessageView content="Make the settings rows a little tighter." />
        <span {...props(styles.actions)}>
          <Button variant="solid" tone="primary">
            Create Pull Request
          </Button>
        </span>
      </div>
    </div>
  );
}

const styles = create({
  window: {
    display: "flex",
    backgroundColor: role.windowWash,
    backgroundImage: `linear-gradient(${role.sidebarMaterial}, ${role.sidebarMaterial})`,
  },
  sidebar: {
    display: "flex",
    flexDirection: "column",
    gap: sidebar.listGap,
    width: 208,
    flexShrink: 0,
    padding: sidebar.gutter,
  },
  card: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    gap: conversation.rowGap,
    flex: 1,
    minWidth: 0,
    marginBlock: shell.cardInset,
    marginInlineEnd: shell.cardInset,
    padding: space.s4,
    borderRadius: shell.cardRadius,
    backgroundColor: role.surfaceMaterial,
    boxShadow: `0 0 0 1px ${role.strokeQuaternary}`,
  },
  actions: { display: "flex", justifyContent: "flex-end" },
});
