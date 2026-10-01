import { Tabs } from "@nyte-ai/ui/tabs";
import { props } from "@stylexjs/stylex";
// oxlint-disable-next-line no-restricted-imports -- the shortcut and input focus follow the open state
import { useEffect, useId, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import type { SessionId, SessionInfo } from "@nyte-ai/protocol";
import { CommandMenuContent, Menu, MenuItem, MenuTrigger } from "@nyte-ai/ui/menu";
import { Icon, type IconName } from "@nyte-ai/ui/icon";
import { Input } from "@nyte-ai/ui/input";
import { formatTimeAgo, StatusDot } from "../components/ui.tsx";
import { srOnly } from "@nyte-ai/ui/a11y.stylex";
import { Kbd } from "@nyte-ai/ui/kbd";
import { macPlatform } from "../platform.ts";
import { sessionActivityMark } from "../session-activity.ts";
import { useOptimisticSessionIds } from "../use-outbox.ts";
import { isOption, sessionsForNavigation } from "./sidebar-view.ts";
import { useSessionPreview, useSessionSearch } from "../queries.ts";
import { PaletteLegend } from "./palette-legend.tsx";
import { searchPaletteStyles as styles } from "./search-palette.stylex.ts";
import {
  sessionHasUnreadCompletion,
  sessionReadState,
  useReadSessions,
} from "../session-read-state.ts";
import { settingsSectionGroups, type SettingsSection } from "./settings-navigation.tsx";
import {
  clientActionKeys,
  clientActions,
  clientCapabilities,
  resolveClientAction,
} from "../client-actions.ts";
import { nyte } from "../nyte.ts";

const TABS = ["all", "agents", "actions", "settings"] as const;

type PaletteTab = (typeof TABS)[number];

interface SearchPaletteProps {
  readonly trigger: ReactElement;
  readonly open: boolean;
  readonly platform: NodeJS.Platform | undefined;
  readonly sessionQueriesAvailable: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onOpenSession: (sessionId: SessionId) => void;
  readonly onNewChat: () => void;
  readonly onOpenFolder: (() => void) | undefined;
  readonly onOpenHome: (() => void) | undefined;
  readonly onOpenSettings: (section: SettingsSection) => void;
  readonly onOpenCustomize: () => void;
}

interface PaletteAction {
  readonly key: string;
  readonly label: string;
  readonly keywords: string;
  readonly icon: IconName;
  readonly group: "actions" | "settings";
  readonly meta?: ReactNode;
  readonly run: () => void;
}

function sessionTitle(session: SessionInfo): string {
  return session.name ?? session.preview ?? "New chat";
}

function matches(action: PaletteAction, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();

  return (
    normalized === "" ||
    action.label.toLocaleLowerCase().includes(normalized) ||
    action.keywords.includes(normalized)
  );
}

function tabLabel(tab: PaletteTab): string {
  switch (tab) {
    case "all":
      return "All";
    case "agents":
      return "Chats";
    case "actions":
      return "Actions";
    case "settings":
      return "Settings";
    default: {
      const _exhaustive: never = tab;

      return _exhaustive;
    }
  }
}

export function SearchPalette({
  trigger,
  open,
  platform,
  sessionQueriesAvailable,
  onOpenChange,
  onOpenSession,
  onNewChat,
  onOpenFolder,
  onOpenHome,
  onOpenSettings,
  onOpenCustomize,
}: SearchPaletteProps): ReactElement {
  const popupRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsID = useId();
  const triggerID = useId();
  const readSessions = useReadSessions();
  const optimisticSessions = useOptimisticSessionIds();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<PaletteTab>("all");
  const includesAgents = tab === "all" || tab === "agents";
  const searchingAgents = includesAgents && query.trim() !== "";
  const recentSessions = useSessionPreview(open && sessionQueriesAvailable && includesAgents);
  const sessionSearch = useSessionSearch(query, open && sessionQueriesAvailable && searchingAgents);

  const sessions = sessionsForNavigation(
    searchingAgents ? (sessionSearch.data?.items ?? []) : (recentSessions.data?.items ?? []),
  );

  const mac = macPlatform(platform);
  const settingsSections = settingsSectionGroups().flat();

  const actions: readonly PaletteAction[] = Object.values(clientActions).flatMap((action) => {
    if (!("palette" in action)) return [];

    if (action.id === "model-settings" && !settingsSections.includes("providers")) return [];

    if (action.id === "account-settings" && !settingsSections.includes("accounts")) return [];

    if (action.id === "open-folder" && onOpenFolder === undefined) return [];

    if (action.id === "open-home" && onOpenHome === undefined) return [];

    const run = (): void => {
      switch (action.id) {
        case "new-chat":
          return onNewChat();
        case "open-folder":
          return onOpenFolder?.();
        case "open-home":
          return onOpenHome?.();
        case "general-settings":
          return onOpenSettings("general");
        case "appearance-settings":
          return onOpenSettings("appearance");
        case "model-settings":
          return onOpenSettings("providers");
        case "account-settings":
          return onOpenSettings("accounts");
        case "customize-settings":
          return onOpenCustomize();
        default: {
          const _exhaustive: never = action;

          return _exhaustive;
        }
      }
    };

    const keys = clientActionKeys(action, mac);

    return [
      {
        key: action.id,
        label: action.label,
        ...action.palette,
        meta: keys.length === 0 ? undefined : <Kbd keys={keys} plain />,
        run,
      },
    ];
  });

  const visibleActions = actions.filter(
    (action) => (tab === "all" || tab === action.group) && matches(action, query),
  );

  // One stable node the whole time the palette is open: a live region that
  // appears and disappears with the list announces nothing.
  const resultCount =
    tab === "agents"
      ? sessions.length
      : tab === "all"
        ? sessions.length + visibleActions.length
        : visibleActions.length;

  const changeOpen = (nextOpen: boolean): void => {
    if (nextOpen) setTab("all");
    else setQuery("");
    onOpenChange(nextOpen);
  };

  const run = (action: () => void): void => {
    onOpenChange(false);
    action();
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        resolveClientAction(event, mac, "workspace", clientCapabilities(nyte.host))?.id !== "search"
      )
        return;
      event.preventDefault();

      if (open) setQuery("");
      else setTab("all");
      onOpenChange(!open);
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mac, open, onOpenChange]);

  useEffect(() => {
    if (!open) return undefined;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());

    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const focusResult = (edge: "first" | "last"): void => {
    const items = popupRef.current?.querySelectorAll<HTMLElement>(
      '[role="menuitem"]:not([data-disabled])',
    );

    if (items === undefined || items.length === 0) return;
    items[edge === "first" ? 0 : items.length - 1]?.focus();
  };

  const agentContent = (embedded = false): ReactElement | null => {
    if (!sessionQueriesAvailable)
      return embedded ? null : (
        <div aria-busy="true" {...props(styles.empty)}>
          Loading chats…
        </div>
      );

    if (searchingAgents ? sessionSearch.isPending : recentSessions.isPending)
      return (
        <div aria-busy="true" {...props(styles.empty)}>
          Loading chats…
        </div>
      );

    if (searchingAgents ? sessionSearch.isError : recentSessions.isError)
      return embedded ? null : (
        <div role="alert" {...props(styles.empty)}>
          Couldn&rsquo;t load chats. Try again.
        </div>
      );

    if (sessions.length === 0)
      return embedded ? null : (
        <div {...props(styles.empty)}>
          {searchingAgents ? `No chats match "${query.trim()}"` : "No chats yet"}
        </div>
      );

    return (
      <>
        <div {...props(styles.groupLabel)}>{searchingAgents ? "Chats" : "Recent chats"}</div>
        {sessions.map((session) => (
          <MenuItem
            key={session.sessionId}
            xstyle={styles.result}
            leading={
              <StatusDot
                mark={sessionActivityMark(session, optimisticSessions.has(session.sessionId))}
                unread={sessionHasUnreadCompletion(session, readSessions)}
              />
            }
            meta={formatTimeAgo(session.lastActivityAt)}
            label={sessionTitle(session)}
            onClick={() =>
              run(() => {
                sessionReadState.markRead(session);
                onOpenSession(session.sessionId);
              })
            }
          >
            {sessionTitle(session)}
          </MenuItem>
        ))}
      </>
    );
  };

  return (
    <Menu open={open} triggerId={triggerID} onOpenChange={changeOpen}>
      <MenuTrigger id={triggerID} render={trigger} />
      <CommandMenuContent ref={popupRef}>
        <Tabs.Root
          variant="pill"
          value={tab}
          xstyle={styles.root}
          onValueChange={(value) => {
            if (isOption(value, TABS)) setTab(value);
          }}
        >
          <search {...props(styles.searchRow)}>
            <Icon name="search" size={15} />
            <Input
              ref={inputRef}
              variant="bare"
              size="xl"
              aria-label="Search"
              aria-controls={`${resultsID}-${tab}`}
              autoComplete="off"
              spellCheck={false}
              placeholder="Search chats and actions…"
              value={query}
              xstyle={styles.input}
              onValueChange={setQuery}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  focusResult("first");
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  focusResult("last");
                } else if (
                  event.key === "Home" ||
                  event.key === "End" ||
                  (event.key.length === 1 && !event.metaKey && !event.ctrlKey)
                ) {
                  // The menu's typeahead and list navigation would cancel text editing.
                  event.stopPropagation();
                }
              }}
            />
            <Kbd keys={clientActionKeys(clientActions.search, mac)} />
          </search>
          <Tabs.List aria-label="Search categories" xstyle={styles.tabs}>
            {TABS.map((option) => (
              <Tabs.Tab key={option} value={option}>
                {tabLabel(option)}
              </Tabs.Tab>
            ))}
          </Tabs.List>
          <div role="status" {...props(srOnly)}>
            {`${String(resultCount)} ${resultCount === 1 ? "result" : "results"}`}
          </div>
          <Tabs.Panel id={`${resultsID}-agents`} value="agents" xstyle={styles.results}>
            {agentContent()}
          </Tabs.Panel>
          <Tabs.Panel id={`${resultsID}-all`} value="all" xstyle={styles.results}>
            {agentContent(true)}
            {visibleActions.length > 0 && (
              <>
                <div {...props(styles.groupLabel)}>Actions</div>
                {visibleActions.map((action) => (
                  <MenuItem
                    key={action.key}
                    xstyle={styles.result}
                    leading={
                      <span {...props(styles.resultIcon)}>
                        <Icon name={action.icon} size={16} />
                      </span>
                    }
                    meta={action.meta}
                    label={action.label}
                    onClick={() => run(action.run)}
                  >
                    {action.label}
                  </MenuItem>
                ))}
              </>
            )}
          </Tabs.Panel>
          {(["actions", "settings"] as const).map((panelTab) => (
            <Tabs.Panel
              key={panelTab}
              id={`${resultsID}-${panelTab}`}
              value={panelTab}
              xstyle={styles.results}
            >
              {visibleActions.length === 0 ? (
                <div {...props(styles.empty)}>No {panelTab} match this search.</div>
              ) : (
                <>
                  <div {...props(styles.groupLabel)}>{tabLabel(panelTab)}</div>
                  {visibleActions.map((action) => (
                    <MenuItem
                      key={action.key}
                      xstyle={styles.result}
                      leading={
                        <span {...props(styles.resultIcon)}>
                          <Icon name={action.icon} size={16} />
                        </span>
                      }
                      meta={action.meta}
                      label={action.label}
                      onClick={() => run(action.run)}
                    >
                      {action.label}
                    </MenuItem>
                  ))}
                </>
              )}
            </Tabs.Panel>
          ))}
        </Tabs.Root>
        <PaletteLegend />
      </CommandMenuContent>
    </Menu>
  );
}
