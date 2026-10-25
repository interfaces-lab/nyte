import { props } from "@stylexjs/stylex";
import { useState, type ReactElement, type ReactNode } from "react";
import { clientActionKeys, clientActions } from "@nyte-ai/app/client-actions.ts";
import { sidebarStyles } from "@nyte-ai/app/chrome/sidebar.stylex.ts";
import { StatusDot } from "@nyte-ai/app/components/ui.tsx";
import { Button } from "@nyte-ai/ui/button";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { Icon } from "@nyte-ai/ui/icon";
import type { IconName } from "@nyte-ai/ui/icon";
import { Kbd } from "@nyte-ai/ui/kbd";
import { Row } from "@nyte-ai/ui/row";
import { focus } from "@nyte-ai/ui/styles/a11y.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import type { Chat } from "./chats.ts";
import { styles } from "./page.stylex";
import type { Status } from "./view.ts";

export function StatusGlyph({ status }: { readonly status: Status | null }): ReactElement | null {
  switch (status) {
    case null:
      return null;
    case "needs-you":
      return <StatusDot mark="waiting" />;
    case "failing":
      return <StatusDot mark="failed" />;
    case "working":
      return <StatusDot mark="working" />;
    case "watching":
      return <Icon name="eye" size={14} label="Watching" />;
    case "ready":
      return <Icon name="checkmark" size={14} label="Ready" />;
    case "idle":
      return <Icon name="git-branch" size={14} label="Open" />;
    case "merged":
      return <Icon name="merged" size={14} label="Merged" />;
    default: {
      const _exhaustive: never = status;

      return _exhaustive;
    }
  }
}

export function askLine(chat: Chat): string | null {
  if (chat.ask?.kind === "rebase") return "Rebase onto main?";

  if (chat.ask?.kind === "merge") return "Ready to merge";

  if (chat.status !== "failing") return null;
  const failing = chat.units.filter((unit) => unit.status === "failing").length;

  return `${String(failing)} pull ${failing === 1 ? "request" : "requests"} failing`;
}

function NavRow({
  icon,
  label,
  keys,
  persistent = false,
  trailing,
}: {
  readonly icon: IconName;
  readonly label: string;
  readonly keys?: readonly string[];
  readonly persistent?: boolean;
  readonly trailing?: ReactNode;
}): ReactElement {
  return (
    <Row variant="nav" xstyle={sidebarStyles.navRow}>
      <Row.Leading xstyle={sidebarStyles.navLeading}>
        <Icon name={icon} size={14} />
      </Row.Leading>
      <Row.Label>{label}</Row.Label>
      {keys !== undefined && (
        <span
          {...props(sidebarStyles.shortcutSlot, persistent && sidebarStyles.shortcutPersistent)}
        >
          <Kbd keys={keys} />
        </span>
      )}
      {trailing}
    </Row>
  );
}

function Section({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  const [open, setOpen] = useState(true);

  return (
    <section aria-label={label} {...props(sidebarStyles.section)}>
      <Collapsible.Root open={open} onOpenChange={setOpen} {...props(sidebarStyles.section)}>
        <div {...props(sidebarStyles.sectionHeader)}>
          <Collapsible.Trigger xstyle={[sidebarStyles.sectionToggle, focus.ringInset]}>
            <span {...props(sidebarStyles.sectionLabel)}>{label}</span>
            <Collapsible.Chevron xstyle={sidebarStyles.sectionChevron} />
          </Collapsible.Trigger>
        </div>
        <Collapsible.Panel {...props(sidebarStyles.workspaceCollection)}>
          {children}
        </Collapsible.Panel>
      </Collapsible.Root>
    </section>
  );
}

function GroupRow({
  name,
  title,
  glyph,
  meta,
  action,
  children,
}: {
  readonly name: string;
  readonly title: string;
  readonly glyph: (expanded: boolean) => IconName;
  readonly meta?: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}): ReactElement {
  const [expanded, setExpanded] = useState(true);

  return (
    <Collapsible.Root open={expanded} onOpenChange={setExpanded} {...props(sidebarStyles.section)}>
      <Row revealActions xstyle={[sidebarStyles.rowSurface, sidebarStyles.workspaceRow]}>
        <Row.Primary
          xstyle={sidebarStyles.workspacePrimary}
          render={<Collapsible.Trigger variant="plain" title={title} />}
        >
          <Row.Leading xstyle={sidebarStyles.rowIcon}>
            <span {...props(sidebarStyles.workspaceGlyph)}>
              <span {...props(sidebarStyles.workspaceFolder)}>
                <Icon name={glyph(expanded)} size={14} />
              </span>
              <span
                {...props(
                  sidebarStyles.workspaceChevron,
                  expanded && sidebarStyles.workspaceChevronOpen,
                )}
              >
                <Icon name="chevron-down" size={13} />
              </span>
            </span>
          </Row.Leading>
          <Row.Label>{name}</Row.Label>
          {meta !== undefined && <Row.Meta xstyle={sidebarStyles.rowMeta}>{meta}</Row.Meta>}
        </Row.Primary>
        {action !== undefined && <Row.Actions placement="overlay">{action}</Row.Actions>}
      </Row>
      <Collapsible.Panel {...props(sidebarStyles.sessionList)}>{children}</Collapsible.Panel>
    </Collapsible.Root>
  );
}

function ChatRow({
  chat,
  selected,
  draggable,
  onOpen,
  onMove,
}: {
  readonly chat: Chat;
  readonly selected: boolean;
  readonly draggable: boolean;
  readonly onOpen: () => void;
  readonly onMove: (() => void) | undefined;
}): ReactElement {
  const ask = askLine(chat);

  const label = <Row.Label xstyle={sidebarStyles.sessionLabel}>{chat.title}</Row.Label>;

  return (
    <Row
      render={
        <div
          draggable={draggable}
          onDragStart={(event) => {
            event.dataTransfer.setData("text/plain", chat.id);
            event.dataTransfer.effectAllowed = "move";
          }}
        />
      }
      selected={selected}
      revealActions
      xstyle={[
        sidebarStyles.rowSurface,
        sidebarStyles.sessionRow,
        selected && sidebarStyles.rowSelected,
        ask !== null && sidebarStyles.sessionRowAsk,
      ]}
    >
      {selected && <Row.Backdrop xstyle={sidebarStyles.sessionSelection} />}
      <Row.Primary aria-current={selected ? "page" : undefined} onClick={onOpen}>
        <Row.Leading xstyle={[sidebarStyles.rowIcon, ask !== null && sidebarStyles.rowIconAsk]}>
          <StatusGlyph status={chat.status} />
        </Row.Leading>
        {ask === null ? (
          label
        ) : (
          <Row.Body>
            <span {...props(sidebarStyles.sessionTitleLine)}>{label}</span>
            <Row.Description
              xstyle={[
                chat.status === "failing" ? intent.danger : intent.warning,
                sidebarStyles.sessionAsk,
              ]}
            >
              {ask}
            </Row.Description>
          </Row.Body>
        )}
      </Row.Primary>
      {onMove !== undefined && (
        <Row.Actions placement="overlay" xstyle={ask !== null && sidebarStyles.rowActionsAsk}>
          <Button
            size="2xs"
            iconOnly
            icon="layers"
            aria-label={`Move ${chat.title} to Polish`}
            onClick={onMove}
          />
        </Row.Actions>
      )}
    </Row>
  );
}

export interface SidebarLane {
  readonly name: string;
  readonly questions: number;
  readonly chats: readonly Chat[];
}

export interface SidebarFolder {
  readonly name: string;
  readonly path: string;
  readonly chats: readonly Chat[];
}

export function ProjectsSidebar({
  lane,
  folder,
  selected,
  movable,
  onOpen,
  onOpenLane,
  onMove,
}: {
  readonly lane: SidebarLane;
  readonly folder: SidebarFolder;
  readonly selected: string;
  readonly movable: string | null;
  readonly onOpen: (chat: string) => void;
  readonly onOpenLane: () => void;
  readonly onMove: (chat: string) => void;
}): ReactElement {
  const [hovering, setHovering] = useState(false);

  return (
    <aside {...props(sidebarStyles.rail)}>
      <div {...props(sidebarStyles.content)}>
        <div {...props(sidebarStyles.primaryActions)}>
          <NavRow
            icon="new-chat"
            label="New Chat"
            keys={clientActionKeys(clientActions.newChat, true)}
            persistent
          />
          <NavRow
            icon="search"
            label="Search"
            keys={clientActionKeys(clientActions.search, true)}
          />
          <NavRow icon="customize" label="Customize" />
          <NavRow icon="server" label="Environments" />
          <NavRow
            icon="settings"
            label="Settings"
            trailing={<Icon name="chevron-right" size={14} />}
          />
        </div>
        <div {...props(sidebarStyles.scroll)}>
          <Section label="Lanes">
            <div
              role="region"
              aria-label={`Drop a chat on ${lane.name}`}
              onDragOver={(event) => {
                if (movable === null) return;
                event.preventDefault();
                setHovering(true);
              }}
              onDragLeave={() => setHovering(false)}
              onDrop={(event) => {
                event.preventDefault();
                setHovering(false);
                const chat = event.dataTransfer.getData("text/plain");

                if (chat === movable) onMove(chat);
              }}
              {...props(styles.drop, hovering && styles.dropActive)}
            >
              <GroupRow
                name={lane.name}
                title={`${lane.name} lane`}
                glyph={() => "layers"}
                meta={
                  lane.questions === 0
                    ? undefined
                    : `${String(lane.questions)} ${lane.questions === 1 ? "question" : "questions"}`
                }
                action={
                  <Button
                    size="sm"
                    iconOnly
                    icon="arrow-right"
                    aria-label={`Open ${lane.name}`}
                    onClick={onOpenLane}
                  />
                }
              >
                {lane.chats.map((chat) => (
                  <ChatRow
                    key={chat.id}
                    chat={chat}
                    selected={chat.id === selected}
                    draggable={false}
                    onOpen={() => onOpen(chat.id)}
                    onMove={undefined}
                  />
                ))}
              </GroupRow>
            </div>
          </Section>
          <Section label="Workspaces">
            <GroupRow
              name={folder.name}
              title={folder.path}
              glyph={(expanded) => (expanded ? "folder-open" : "folder")}
            >
              {folder.chats.map((chat) => (
                <ChatRow
                  key={chat.id}
                  chat={chat}
                  selected={chat.id === selected}
                  draggable={chat.id === movable}
                  onOpen={() => onOpen(chat.id)}
                  onMove={chat.id === movable ? () => onMove(chat.id) : undefined}
                />
              ))}
            </GroupRow>
          </Section>
        </div>
      </div>
    </aside>
  );
}
