import { Tabs } from "@nyte-ai/ui/primitives";
import * as stylex from "@stylexjs/stylex";
import { useEffect, useId, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import type { SessionId, SessionInfo } from "@nyte-ai/core";
import { CommandMenu, MenuItem } from "../components/menu.tsx";
import { Icon, type IconName } from "../components/icons.tsx";
import { focus, formatTimeAgo, Kbd, srOnly, StatusDot } from "../components/ui.tsx";
import { macPlatform } from "../platform.ts";
import { sessionWorking } from "../run-state.ts";
import { isOption } from "./sidebar-view.ts";
import { useSessionPreview, useSessionSearch } from "../queries.ts";
import { searchPaletteStyles as styles } from "./search-palette.stylex.ts";
import type { SettingsSection } from "./settings-navigation.tsx";

const TABS = ["all", "agents", "files", "actions", "settings"] as const;
type PaletteTab = (typeof TABS)[number];

interface SearchPaletteProps {
  readonly trigger: ReactElement;
  readonly open: boolean;
  readonly platform: NodeJS.Platform | undefined;
  readonly sessionQueriesAvailable: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onOpenSession: (sessionId: SessionId) => void;
  readonly onNewChat: () => void;
  readonly onOpenFolder: () => void;
  readonly onOpenHome: (() => void) | undefined;
  readonly onOpenSettings: (section: SettingsSection) => void;
  readonly onOpenCustomize: () => void;
}

interface PaletteAction {
  readonly key: string;
  readonly label: string;
  readonly keywords: string;
  readonly icon: IconName;
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
    case "files":
      return "Files";
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
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<PaletteTab>("all");
  const includesAgents = tab === "all" || tab === "agents";
  const searchingAgents = includesAgents && query.trim() !== "";
  const recentSessions = useSessionPreview(open && sessionQueriesAvailable && includesAgents);
  const sessionSearch = useSessionSearch(query, open && sessionQueriesAvailable && searchingAgents);
  const sessions = (
    searchingAgents ? (sessionSearch.data?.items ?? []) : (recentSessions.data?.items ?? [])
  ).filter((session) => !session.archived);
  const mac = macPlatform(platform);

  const actions: readonly PaletteAction[] = [
    {
      key: "new-chat",
      label: "New chat",
      keywords: "start create conversation session",
      icon: "plus",
      meta: <Kbd keys={mac ? ["⌘", "N"] : ["Ctrl", "N"]} plain />,
      run: onNewChat,
    },
    {
      key: "open-folder",
      label: "Open folder…",
      keywords: "workspace project directory choose",
      icon: "folder-open",
      run: onOpenFolder,
    },
    ...(onOpenHome === undefined
      ? []
      : [
          {
            key: "open-home",
            label: "Open home",
            keywords: "workspace projectless activate",
            icon: "folder" as const,
            run: onOpenHome,
          },
        ]),
  ];
  const settings: readonly PaletteAction[] = [
    {
      key: "general-settings",
      label: "General settings",
      keywords: "preferences configuration",
      icon: "settings",
      run: () => onOpenSettings("general"),
    },
    {
      key: "appearance-settings",
      label: "Appearance",
      keywords: "theme color interface",
      icon: "sparkle",
      run: () => onOpenSettings("appearance"),
    },
    {
      key: "model-settings",
      label: "Models",
      keywords: "providers api key sign in anthropic openai default reasoning",
      icon: "layers",
      run: () => onOpenSettings("models"),
    },
    {
      key: "account-settings",
      label: "Accounts",
      keywords: "github login authentication",
      icon: "user",
      run: () => onOpenSettings("accounts"),
    },
    {
      key: "customize-settings",
      label: "Customize",
      keywords: "agents skills rules mcp",
      icon: "customize",
      run: onOpenCustomize,
    },
  ];
  const visibleActions = (
    tab === "actions"
      ? actions
      : tab === "settings"
        ? settings
        : tab === "all"
          ? [...actions, ...settings]
          : []
  ).filter((action) => matches(action, query));
  // One stable node the whole time the palette is open: a live region that
  // appears and disappears with the list announces nothing.
  const resultCount =
    tab === "files"
      ? 0
      : tab === "agents"
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
      const commandModifier = mac
        ? event.metaKey
        : platform === undefined
          ? event.metaKey || event.ctrlKey
          : event.ctrlKey;
      if (
        !commandModifier ||
        event.altKey ||
        event.shiftKey ||
        event.key.toLocaleLowerCase() !== "k"
      )
        return;
      event.preventDefault();
      changeOpen(!open);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

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
        <div aria-busy="true" {...stylex.props(styles.empty)}>
          Loading chats…
        </div>
      );
    if (searchingAgents ? sessionSearch.isPending : recentSessions.isPending)
      return (
        <div aria-busy="true" {...stylex.props(styles.empty)}>
          Loading chats…
        </div>
      );
    if (searchingAgents ? sessionSearch.isError : recentSessions.isError)
      return embedded ? null : (
        <div role="alert" {...stylex.props(styles.empty)}>
          Couldn&rsquo;t load chats. Try again.
        </div>
      );
    if (sessions.length === 0)
      return embedded ? null : (
        <div {...stylex.props(styles.empty)}>
          {searchingAgents ? `No chats match "${query.trim()}"` : "No chats yet"}
        </div>
      );
    return (
      <>
        <div {...stylex.props(styles.groupLabel)}>{searchingAgents ? "Chats" : "Recent chats"}</div>
        {sessions.map((session) => (
          <MenuItem
            key={session.sessionId}
            itemStyle={styles.result}
            leading={<StatusDot working={sessionWorking(session)} />}
            meta={formatTimeAgo(session.lastActivityAt)}
            textValue={sessionTitle(session)}
            onSelect={() => run(() => onOpenSession(session.sessionId))}
          >
            {sessionTitle(session)}
          </MenuItem>
        ))}
      </>
    );
  };

  return (
    <CommandMenu
      label="Search"
      trigger={trigger}
      open={open}
      onOpenChange={changeOpen}
      popupRef={popupRef}
    >
      <Tabs.Root
        value={tab}
        {...stylex.props(styles.root)}
        onValueChange={(value) => {
          if (isOption(value, TABS)) setTab(value);
        }}
      >
        <search {...stylex.props(styles.searchRow)}>
          <Icon name="search" size={15} />
          <input
            ref={inputRef}
            aria-label="Search"
            aria-controls={`${resultsID}-${tab}`}
            autoComplete="off"
            spellCheck={false}
            placeholder="Search chats, files, and actions…"
            value={query}
            {...stylex.props(styles.input)}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                focusResult("first");
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                focusResult("last");
              }
            }}
          />
          <Kbd keys={mac ? ["⌘", "K"] : ["Ctrl", "K"]} />
        </search>
        <Tabs.List aria-label="Search categories" {...stylex.props(styles.tabs)}>
          {TABS.map((option) => (
            <Tabs.Tab
              key={option}
              value={option}
              {...stylex.props(styles.tab, tab === option && styles.tabSelected, focus.ringInset)}
            >
              {tabLabel(option)}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        <div role="status" {...stylex.props(srOnly)}>
          {`${String(resultCount)} ${resultCount === 1 ? "result" : "results"}`}
        </div>
        <Tabs.Panel id={`${resultsID}-agents`} value="agents" {...stylex.props(styles.results)}>
          {agentContent()}
        </Tabs.Panel>
        <Tabs.Panel id={`${resultsID}-files`} value="files" {...stylex.props(styles.results)}>
          <div {...stylex.props(styles.empty)}>No recent files.</div>
        </Tabs.Panel>
        <Tabs.Panel id={`${resultsID}-all`} value="all" {...stylex.props(styles.results)}>
          {agentContent(true)}
          {visibleActions.length > 0 && (
            <>
              <div {...stylex.props(styles.groupLabel)}>Actions</div>
              {visibleActions.map((action) => (
                <MenuItem
                  key={action.key}
                  itemStyle={styles.result}
                  icon={action.icon}
                  meta={action.meta}
                  textValue={action.label}
                  onSelect={() => run(action.run)}
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
            {...stylex.props(styles.results)}
          >
            {visibleActions.length === 0 ? (
              <div {...stylex.props(styles.empty)}>No {panelTab} match this search.</div>
            ) : (
              <>
                <div {...stylex.props(styles.groupLabel)}>{tabLabel(panelTab)}</div>
                {visibleActions.map((action) => (
                  <MenuItem
                    key={action.key}
                    itemStyle={styles.result}
                    icon={action.icon}
                    meta={action.meta}
                    textValue={action.label}
                    onSelect={() => run(action.run)}
                  >
                    {action.label}
                  </MenuItem>
                ))}
              </>
            )}
          </Tabs.Panel>
        ))}
      </Tabs.Root>
    </CommandMenu>
  );
}
