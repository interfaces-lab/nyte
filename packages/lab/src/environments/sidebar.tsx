import { props } from "@stylexjs/stylex";
import { useState, type ReactElement } from "react";
import { focus } from "@nyte-ai/ui/a11y.stylex";
import { sidebarStyles } from "@nyte-ai/app/chrome/sidebar.stylex.ts";
import { WorkspaceControls } from "@nyte-ai/app/chrome/sidebar-filter.tsx";
import {
  DEFAULT_SESSION_VIEW,
  type SessionViewSettings,
} from "@nyte-ai/app/chrome/sidebar-view.ts";
import { StatusDot } from "@nyte-ai/app/components/ui.tsx";
import { Button } from "@nyte-ai/ui/button";
import { Collapsible } from "@nyte-ai/ui/collapsible";
import { Icon } from "@nyte-ai/ui/icon";
import { Kbd } from "@nyte-ai/ui/kbd";
import { Row } from "@nyte-ai/ui/row";
import { rowsOf, type LabEnvironment, type LabRow } from "./fixtures";
import { railStyles as styles } from "./sidebar.stylex";

/**
 * Nothing marks a chat on this machine. A chat elsewhere gets a corner badge
 * on its status glyph; a finished one, with no glyph, shows the badge's icon
 * alone. Rows on a machine you can't reach fade.
 */
function Leading({
  row,
  elsewhere,
}: {
  readonly row: LabRow;
  readonly elsewhere: boolean;
}): ReactElement {
  if (!elsewhere) return <StatusDot mark={row.mark} />;

  return (
    <span {...props(styles.badgeHost)} title={row.environment.name}>
      {row.mark === "idle" ? (
        <Icon name={row.environment.icon} size={12} label={row.environment.name} />
      ) : (
        <>
          <StatusDot mark={row.mark} />
          <span {...props(styles.badge)}>
            <Icon name={row.environment.icon} size={9} />
          </span>
        </>
      )}
    </span>
  );
}

function SessionRow({
  row,
  elsewhere,
  selected,
  onSelect,
}: {
  readonly row: LabRow;
  readonly elsewhere: boolean;
  readonly selected: boolean;
  readonly onSelect: () => void;
}): ReactElement {
  const unreachable = !row.environment.online;

  return (
    <Row
      selected={selected}
      revealActions
      xstyle={[
        sidebarStyles.rowSurface,
        sidebarStyles.sessionRow,
        selected && sidebarStyles.rowSelected,
        row.ask !== undefined && sidebarStyles.sessionRowAsk,
      ]}
    >
      {selected && <Row.Backdrop xstyle={sidebarStyles.sessionSelection} />}
      <Row.Primary
        xstyle={[sidebarStyles.rowPrimary, unreachable && styles.unreachable]}
        aria-current={selected ? "page" : undefined}
        onClick={onSelect}
      >
        <Row.Leading
          xstyle={[sidebarStyles.rowIcon, row.ask !== undefined && sidebarStyles.rowIconAsk]}
        >
          <Leading row={row} elsewhere={elsewhere} />
        </Row.Leading>
        {row.ask === undefined ? (
          <Row.Label xstyle={sidebarStyles.sessionLabel}>{row.title}</Row.Label>
        ) : (
          <Row.Body>
            <Row.Label xstyle={sidebarStyles.sessionLabel}>{row.title}</Row.Label>
            <Row.Description
              xstyle={
                row.mark === "failed"
                  ? sidebarStyles.sessionAskFailed
                  : sidebarStyles.sessionAskWaiting
              }
            >
              {row.ask}
            </Row.Description>
          </Row.Body>
        )}
        <Row.Meta xstyle={sidebarStyles.rowMeta}>{row.elapsed}</Row.Meta>
      </Row.Primary>
      <Row.Actions
        placement="overlay"
        xstyle={[sidebarStyles.rowActions, sidebarStyles.rowActionsBesideMeta]}
      >
        <Button size="icon-xs" icon="pin" aria-label="Pin" />
        <Button size="icon-xs" aria-label="Archive">
          <span {...props(sidebarStyles.actionGlyphArchive)}>
            <Icon name="archive" size={12} />
          </span>
        </Button>
      </Row.Actions>
    </Row>
  );
}

export function EnvironmentSidebar({
  environments,
  home,
  selected,
  environmentsOpen,
  onSelect,
  onNewChat,
  onOpenEnvironments,
}: {
  readonly environments: readonly LabEnvironment[];
  /** The machine this surface runs on. Web has none, so every chat is elsewhere. */
  readonly home: string | undefined;
  readonly selected: string | undefined;
  readonly environmentsOpen: boolean;
  readonly onSelect: (title: string) => void;
  readonly onNewChat: () => void;
  readonly onOpenEnvironments: () => void;
}): ReactElement {
  const [view, setView] = useState<SessionViewSettings>(DEFAULT_SESSION_VIEW);
  const [homeVisible, setHomeVisible] = useState(true);
  const [listOpen, setListOpen] = useState(true);
  // With one environment there is nothing to tell apart, so no row is marked.
  const several = environments.length > 1;

  return (
    <aside {...props(sidebarStyles.rail, styles.rail)}>
      <div {...props(sidebarStyles.primaryActions)}>
        <Row variant="nav" xstyle={sidebarStyles.navRow} onClick={onNewChat}>
          <Row.Leading>
            <Icon name="new-chat" size={14} />
          </Row.Leading>
          <Row.Label>New Chat</Row.Label>
          <span {...props(sidebarStyles.shortcutSlot, sidebarStyles.shortcutPersistent)}>
            <Kbd keys={["⌘", "N"]} />
          </span>
        </Row>
        <Row variant="nav" xstyle={sidebarStyles.navRow}>
          <Row.Leading>
            <Icon name="search" size={14} />
          </Row.Leading>
          <Row.Label>Search</Row.Label>
          <span {...props(sidebarStyles.shortcutSlot)}>
            <Kbd keys={["⌘", "K"]} />
          </span>
        </Row>
        <Row variant="nav" xstyle={sidebarStyles.navRow}>
          <Row.Leading>
            <Icon name="customize" size={14} />
          </Row.Leading>
          <Row.Label>Customize</Row.Label>
        </Row>
        <Row
          variant="nav"
          selected={environmentsOpen}
          aria-current={environmentsOpen ? "page" : undefined}
          xstyle={sidebarStyles.navRow}
          onClick={onOpenEnvironments}
        >
          <Row.Leading>
            <Icon name="server" size={14} />
          </Row.Leading>
          <Row.Label>Environments</Row.Label>
        </Row>
      </div>
      <div {...props(sidebarStyles.scroll)}>
        <section aria-label="Chats" {...props(sidebarStyles.section)}>
          <Collapsible.Root
            open={listOpen}
            onOpenChange={setListOpen}
            {...props(sidebarStyles.section)}
          >
            <div {...props(sidebarStyles.sectionHeader)}>
              <Collapsible.Trigger xstyle={[sidebarStyles.sectionToggle, focus.ringInset]}>
                <span {...props(sidebarStyles.sectionLabel)}>Chats</span>
                <Collapsible.Chevron xstyle={sidebarStyles.sectionChevron} />
              </Collapsible.Trigger>
              <WorkspaceControls
                value={view}
                filterDisabled={false}
                homeVisible={homeVisible}
                onHomeVisibleChange={setHomeVisible}
                onChange={setView}
                onOpenFolder={() => undefined}
                onCollapseAll={() => setListOpen(false)}
              />
            </div>
            <Collapsible.Panel {...props(sidebarStyles.sessionList)}>
              {rowsOf(environments).map((row) => (
                <SessionRow
                  key={row.title}
                  row={row}
                  elsewhere={several && row.environment.id !== home}
                  selected={!environmentsOpen && row.title === selected}
                  onSelect={() => onSelect(row.title)}
                />
              ))}
            </Collapsible.Panel>
          </Collapsible.Root>
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
          <Button size="icon" icon="settings" aria-label="Settings" />
        </div>
      </div>
    </aside>
  );
}
