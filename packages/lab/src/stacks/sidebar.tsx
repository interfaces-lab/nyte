import { props } from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";
import { clientActionKeys, clientActions } from "@nyte-ai/app/client-actions.ts";
import { sidebarStyles } from "@nyte-ai/app/chrome/sidebar.stylex.ts";
import { StatusDot } from "@nyte-ai/app/components/ui.tsx";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import type { IconName } from "@nyte-ai/ui/icon";
import { Kbd } from "@nyte-ai/ui/kbd";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@nyte-ai/ui/menu";
import { Row } from "@nyte-ai/ui/row";
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
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section aria-label={label} {...props(sidebarStyles.section)}>
      <div {...props(sidebarStyles.sectionHeader)}>
        <span {...props(sidebarStyles.sectionToggle)}>
          <span {...props(sidebarStyles.sectionLabel)}>{label}</span>
        </span>
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
  action,
}: {
  readonly glyph: ReactNode;
  readonly label: string;
  readonly meta?: string;
  readonly selected: boolean;
  readonly onOpen?: () => void;
  readonly action?: ReactNode;
}): ReactElement {
  return (
    <Row
      selected={selected}
      revealActions
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
      {action !== undefined && action !== false && (
        <Row.Actions placement="overlay">{action}</Row.Actions>
      )}
    </Row>
  );
}

export interface SidebarStack {
  readonly id: string;
  readonly name: string;
  readonly icon: IconName;
  readonly waiting: number;
}

/** No drag and no disclosure: a stack is one row, and a chat hands itself over from its own row. */
export function StacksSidebar({
  stacks,
  selected,
  creating,
  inbox,
  waiting,
  chats,
  handed,
  onInbox,
  onOpenStack,
  onNewStack,
  onHand,
}: {
  readonly stacks: readonly SidebarStack[];
  readonly selected: string | null;
  readonly creating: boolean;
  readonly inbox: boolean;
  readonly waiting: number;
  readonly onInbox: () => void;
  readonly chats: readonly Chat[];
  readonly handed: Readonly<Record<string, string>>;
  readonly onOpenStack: (stack: string) => void;
  readonly onNewStack: () => void;
  readonly onHand: (chat: Chat, stack: string) => void;
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
          <ListRow
            glyph={<Icon name={waiting === 0 ? "inbox-checked" : "inbox-empty"} size={14} />}
            label="Needs You"
            meta={waiting === 0 ? undefined : String(waiting)}
            selected={inbox}
            onOpen={onInbox}
          />
          <NavRow icon="customize" label="Customize" />
          <NavRow icon="settings" label="Settings" />
        </div>
        <div {...props(sidebarStyles.scroll)}>
          <Section label="Stacks">
            {stacks.map((stack) => (
              <ListRow
                key={stack.id}
                glyph={<Icon name={stack.icon} size={14} />}
                label={stack.name}
                meta={stack.waiting === 0 ? undefined : `${String(stack.waiting)} for you`}
                selected={stack.id === selected}
                onOpen={() => onOpenStack(stack.id)}
              />
            ))}
            <ListRow
              glyph={<Icon name="plus" size={14} />}
              label="New Stack"
              selected={creating}
              onOpen={onNewStack}
            />
          </Section>
          <Section label="nyte">
            {chats.map((chat) => {
              const home = stacks.find((stack) => stack.id === handed[chat.id]);

              return (
                <ListRow
                  key={chat.id}
                  glyph={
                    home === undefined ? (
                      chat.working && <StatusDot mark="working" />
                    ) : (
                      <Icon name={home.icon} size={14} label={`In ${home.name}`} />
                    )
                  }
                  label={chat.title}
                  selected={false}
                  onOpen={home === undefined ? undefined : () => onOpenStack(home.id)}
                  action={
                    home === undefined && (
                      <Menu>
                        <MenuTrigger
                          render={
                            <Button
                              size="2xs"
                              iconOnly
                              icon="layers"
                              aria-label="Hand to a Stack"
                            />
                          }
                        />
                        <MenuContent align="end">
                          {stacks.map((stack) => (
                            <MenuItem
                              key={stack.id}
                              icon={stack.icon}
                              onClick={() => onHand(chat, stack.id)}
                            >
                              Hand to {stack.name}
                            </MenuItem>
                          ))}
                        </MenuContent>
                      </Menu>
                    )
                  }
                />
              );
            })}
          </Section>
        </div>
      </div>
    </aside>
  );
}
