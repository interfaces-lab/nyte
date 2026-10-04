import { props } from "@stylexjs/stylex";
import type { MouseEvent, ReactElement } from "react";
import { sidebarStyles } from "@nyte-ai/app/chrome/sidebar.stylex.ts";
import { StatusDot } from "@nyte-ai/app/components/ui.tsx";
import { intent } from "@nyte-ai/ui/surface-theme";
import { Button } from "@nyte-ai/ui/button";
import { Icon, type IconName } from "@nyte-ai/ui/icon";
import { Kbd } from "@nyte-ai/ui/kbd";
import { Row } from "@nyte-ai/ui/row";
import { SIDEBAR_CHATS } from "./fixtures";
import { samePage, type OpenTarget, type Place } from "./model";
import { openTarget } from "./place";
import { railStyles as styles } from "./tabs.stylex";

type Open = (place: Place, target: OpenTarget) => void;

/** Rows open in place; ⌘-click and middle-click leave the current tab where it is. */
function linkHandlers(place: Place, onOpen: Open) {
  return {
    onClick: (event: MouseEvent) => onOpen(place, openTarget(event)),
    onMouseDown: (event: MouseEvent) => {
      if (event.button === 1) event.preventDefault();
    },
    onAuxClick: (event: MouseEvent) => {
      if (event.button === 1) onOpen(place, "background");
    },
  };
}

function NavRow({
  icon,
  label,
  place,
  current,
  shortcut,
  onOpen,
}: {
  readonly icon: IconName;
  readonly label: string;
  readonly place: Place | undefined;
  readonly current: Place;
  readonly shortcut?: readonly string[];
  readonly onOpen: Open;
}): ReactElement {
  const selected = place !== undefined && samePage(place, current);

  return (
    <Row
      variant="nav"
      selected={selected}
      aria-current={selected ? "page" : undefined}
      xstyle={sidebarStyles.navRow}
      {...(place === undefined ? {} : linkHandlers(place, onOpen))}
    >
      <Row.Leading>
        <Icon name={icon} size={14} />
      </Row.Leading>
      <Row.Label>{label}</Row.Label>
      {shortcut !== undefined && (
        <span {...props(sidebarStyles.shortcutSlot, sidebarStyles.shortcutPersistent)}>
          <Kbd keys={shortcut} />
        </span>
      )}
    </Row>
  );
}

export function Sidebar({
  current,
  onOpen,
}: {
  readonly current: Place;
  readonly onOpen: Open;
}): ReactElement {
  return (
    <aside {...props(sidebarStyles.rail, styles.rail)}>
      <div {...props(sidebarStyles.primaryActions)}>
        <NavRow
          icon="new-chat"
          label="New Chat"
          place={{ kind: "new-chat" }}
          current={current}
          shortcut={["⌘", "N"]}
          onOpen={onOpen}
        />
        <NavRow
          icon="search"
          label="Search"
          place={undefined}
          current={current}
          shortcut={["⌘", "K"]}
          onOpen={onOpen}
        />
        <NavRow
          icon="customize"
          label="Customize"
          place={{ kind: "customize" }}
          current={current}
          onOpen={onOpen}
        />
        <NavRow
          icon="server"
          label="Environments"
          place={{ kind: "environments" }}
          current={current}
          onOpen={onOpen}
        />
      </div>
      <div {...props(sidebarStyles.scroll)}>
        <section aria-label="Chats" {...props(sidebarStyles.section)}>
          <div {...props(sidebarStyles.sectionHeader)}>
            <span {...props(sidebarStyles.sectionToggle)}>
              <span {...props(sidebarStyles.sectionLabel)}>Chats</span>
            </span>
          </div>
          <div {...props(sidebarStyles.sessionList)}>
            {SIDEBAR_CHATS.map((chat) => {
              const place: Place = { kind: "chat", chatId: chat.id };
              const selected = samePage(place, current);

              return (
                <Row
                  key={chat.id}
                  selected={selected}
                  revealActions
                  xstyle={[
                    sidebarStyles.rowSurface,
                    sidebarStyles.sessionRow,
                    selected && sidebarStyles.rowSelected,
                    chat.ask !== undefined && sidebarStyles.sessionRowAsk,
                  ]}
                >
                  {selected && <Row.Backdrop xstyle={sidebarStyles.sessionSelection} />}
                  <Row.Primary
                    aria-current={selected ? "page" : undefined}
                    {...linkHandlers(place, onOpen)}
                  >
                    <Row.Leading
                      xstyle={[
                        sidebarStyles.rowIcon,
                        chat.ask !== undefined && sidebarStyles.rowIconAsk,
                      ]}
                    >
                      <StatusDot mark={chat.mark} />
                    </Row.Leading>
                    {chat.ask === undefined ? (
                      <Row.Label>{chat.title}</Row.Label>
                    ) : (
                      <Row.Body>
                        <Row.Label>{chat.title}</Row.Label>
                        <Row.Description
                          xstyle={
                            chat.mark === "failed"
                              ? [intent.danger, sidebarStyles.sessionAsk]
                              : [intent.warning, sidebarStyles.sessionAsk]
                          }
                        >
                          {chat.ask}
                        </Row.Description>
                      </Row.Body>
                    )}
                    <Row.Meta xstyle={sidebarStyles.rowMeta}>{chat.elapsed}</Row.Meta>
                  </Row.Primary>
                </Row>
              );
            })}
          </div>
        </section>
      </div>
      <div {...props(sidebarStyles.footer)}>
        <div {...props(sidebarStyles.footerRow)}>
          <Row variant="nav" xstyle={[sidebarStyles.navRow, sidebarStyles.accountButton]}>
            <Row.Leading>
              <Icon name="user" size={14} />
            </Row.Leading>
            <Row.Label>Itsnotaka</Row.Label>
          </Row>
          <Button iconOnly icon="settings" aria-label="Settings" />
        </div>
      </div>
    </aside>
  );
}
