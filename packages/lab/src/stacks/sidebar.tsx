import { props } from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";
import { clientActionKeys, clientActions } from "@nyte-ai/app/client-actions.ts";
import { sidebarStyles } from "@nyte-ai/app/chrome/sidebar.stylex.ts";
import { StatusDot } from "@nyte-ai/app/components/ui.tsx";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import type { IconName } from "@nyte-ai/ui/icon";
import { Kbd } from "@nyte-ai/ui/kbd";
import { Row } from "@nyte-ai/ui/row";
import { DraggableChat, DropZone } from "./dnd.tsx";
import type { Chat } from "./model.ts";

function NavRow({
  icon,
  label,
  keys,
}: {
  readonly icon: IconName;
  readonly label: string;
  readonly keys?: readonly string[];
}): ReactElement {
  return (
    <Row variant="nav" xstyle={sidebarStyles.navRow}>
      <Row.Leading xstyle={sidebarStyles.navLeading}>
        <Icon name={icon} size={14} />
      </Row.Leading>
      <Row.Label>{label}</Row.Label>
      {keys !== undefined && (
        <span {...props(sidebarStyles.shortcutSlot, sidebarStyles.shortcutPersistent)}>
          <Kbd keys={keys} />
        </span>
      )}
    </Row>
  );
}

function Section({
  label,
  action,
  children,
}: {
  readonly label: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section aria-label={label} {...props(sidebarStyles.section)}>
      <div {...props(sidebarStyles.sectionHeader)}>
        <span {...props(sidebarStyles.sectionToggle)}>
          <span {...props(sidebarStyles.sectionLabel)}>{label}</span>
        </span>
        {action}
      </div>
      <div {...props(sidebarStyles.sessionList)}>{children}</div>
    </section>
  );
}

function ListRow({
  glyph,
  label,
  meta,
  selected,
  onOpen,
}: {
  readonly glyph: ReactNode;
  readonly label: string;
  readonly meta?: string;
  readonly selected: boolean;
  readonly onOpen?: () => void;
}): ReactElement {
  return (
    <Row
      selected={selected}
      xstyle={[
        sidebarStyles.rowSurface,
        sidebarStyles.sessionRow,
        selected && sidebarStyles.rowSelected,
      ]}
    >
      {selected && <Row.Backdrop xstyle={sidebarStyles.sessionSelection} />}
      <Row.Primary aria-current={selected ? "page" : undefined} onClick={onOpen}>
        <Row.Leading xstyle={sidebarStyles.rowIcon}>{glyph}</Row.Leading>
        <Row.Label xstyle={sidebarStyles.sessionLabel}>{label}</Row.Label>
        {meta !== undefined && <Row.Meta xstyle={sidebarStyles.rowMeta}>{meta}</Row.Meta>}
      </Row.Primary>
    </Row>
  );
}

export interface SidebarStack {
  readonly id: string;
  readonly name: string;
  readonly icon: IconName;
  readonly waiting: number;
}

/**
 * No disclosures. A stack is one row; drag a chat onto it, or onto the stack's page, to hand
 * the chat over.
 */
export function StacksSidebar({
  stacks,
  selected,
  chats,
  handed,
  onOpenStack,
  onNewStack,
}: {
  readonly stacks: readonly SidebarStack[];
  readonly selected: string | null;
  readonly chats: readonly Chat[];
  readonly handed: Readonly<Record<string, string>>;
  readonly onOpenStack: (stack: string) => void;
  readonly onNewStack: () => void;
}): ReactElement {
  return (
    <aside {...props(sidebarStyles.rail)}>
      <div {...props(sidebarStyles.content)}>
        <div {...props(sidebarStyles.primaryActions)}>
          <NavRow
            icon="new-chat"
            label="New Chat"
            keys={clientActionKeys(clientActions.newChat, true)}
          />
          <NavRow icon="search" label="Search" />
          <NavRow icon="customize" label="Customize" />
          <NavRow icon="settings" label="Settings" />
        </div>
        <div {...props(sidebarStyles.scroll)}>
          <Section
            label="Stacks"
            action={
              <Button size="2xs" iconOnly icon="plus" aria-label="New Stack" onClick={onNewStack} />
            }
          >
            {stacks.map((stack) => (
              <DropZone key={stack.id} stack={stack.id} label="sidebar">
                <ListRow
                  glyph={<Icon name={stack.icon} size={14} />}
                  label={stack.name}
                  meta={stack.waiting === 0 ? undefined : `${String(stack.waiting)} for you`}
                  selected={stack.id === selected}
                  onOpen={() => onOpenStack(stack.id)}
                />
              </DropZone>
            ))}
          </Section>
          <Section label="nyte">
            {chats.map((chat) => {
              const home = stacks.find((stack) => stack.id === handed[chat.id]);

              const row = (
                <ListRow
                  glyph={
                    home === undefined ? (
                      chat.working && <StatusDot mark="working" />
                    ) : (
                      <Icon name={home.icon} size={14} label={`In ${home.name}`} />
                    )
                  }
                  label={chat.title}
                  meta={home?.name}
                  selected={false}
                  onOpen={home === undefined ? undefined : () => onOpenStack(home.id)}
                />
              );

              return home === undefined ? (
                <DraggableChat key={chat.id} chat={chat.id}>
                  {row}
                </DraggableChat>
              ) : (
                <div key={chat.id}>{row}</div>
              );
            })}
          </Section>
        </div>
      </div>
    </aside>
  );
}
