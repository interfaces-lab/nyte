import { Tabs } from "@nyte-ai/ui/tabs";
import { props } from "@stylexjs/stylex";
import { useState } from "react";
import type { ReactElement, ReactNode } from "react";
import type { SessionId, SessionInfo } from "@nyte-ai/sdk";
import { Command } from "@nyte-ai/ui/command";
import { Icon, type IconName } from "@nyte-ai/ui/icon";
import { formatTimeAgo } from "../lib/format.ts";
import { useNowMinute } from "../lib/use-now-minute.ts";
import { TaskMark } from "../components/task-mark.tsx";
import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { hairline } from "@nyte-ai/ui/styles/hairline.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { Kbd } from "@nyte-ai/ui/kbd";
import { sessionTitle } from "@nyte-ai/plugin/client/presentation";
import { useChats } from "../chats/index.ts";
import { useChatWindow } from "../window/index.ts";

import { amongOptions, chatMark, sessionsForNavigation } from "./sidebar-view.ts";
import { useSessionSearch } from "../data/sessions.ts";
import { PaletteLegend } from "./palette-legend.tsx";
import { searchPaletteStyles as styles } from "./search-palette.stylex.ts";
import { settingsSectionGroups, type SettingsSection } from "../settings/index.ts";
import { clientActionKeys, clientActions } from "../contract/client-actions.ts";
import { nyte } from "../contract/nyte.ts";
import { actionIcons, settingsActionPages } from "./action-icons.ts";

const TABS = ["all", "agents", "actions", "settings"] as const;

type PaletteTab = (typeof TABS)[number];

interface SearchPaletteProps {
  readonly trigger: ReactElement;
  readonly open: boolean;
  readonly recentSessions: readonly SessionInfo[] | undefined;
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

function ChatGroup({
  heading,
  sessions,
  onOpen,
}: {
  readonly heading: string;
  readonly sessions: readonly SessionInfo[];
  readonly onOpen: (sessionId: SessionId) => void;
}): ReactElement {
  const chats = useChats((directory) => directory);
  const unread = useChatWindow((snapshot) => snapshot.unread);
  const now = useNowMinute();

  return (
    <Command.Group heading={heading}>
      {sessions.map((session) => (
        <Command.Item
          key={session.id}
          value={session.id}
          leading={<TaskMark state={chatMark(session, chats)} unread={unread.has(session.id)} />}
          meta={formatTimeAgo(session.lastActivityAt, now)}
          onClick={() => onOpen(session.id)}
        >
          {sessionTitle(session)}
        </Command.Item>
      ))}
    </Command.Group>
  );
}

export function SearchPalette({
  trigger,
  open,
  recentSessions,
  onOpenChange,
  onOpenSession,
  onNewChat,
  onOpenFolder,
  onOpenHome,
  onOpenSettings,
  onOpenCustomize,
}: SearchPaletteProps): ReactElement {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<PaletteTab>("all");
  const [shownOpen, setShownOpen] = useState(open);

  if (open !== shownOpen) {
    setShownOpen(open);

    if (open) setTab("all");
    else setQuery("");
  }

  const includesAgents = tab === "all" || tab === "agents";
  const searchingAgents = includesAgents && query.trim() !== "";
  const sessionSearch = useSessionSearch(query, open && searchingAgents);

  const sessions = searchingAgents
    ? sessionsForNavigation(sessionSearch.data?.items ?? [])
    : (recentSessions ?? []);

  const mac = nyte.platform === "darwin";
  const settingsSections = settingsSectionGroups().flat();

  const actions: readonly PaletteAction[] = Object.values(clientActions).flatMap((action) => {
    if (!("palette" in action)) return [];

    if (
      action.id === "model-settings" &&
      !settingsSections.includes(settingsActionPages[action.id])
    )
      return [];

    if (
      action.id === "profile-settings" &&
      !settingsSections.includes(settingsActionPages[action.id])
    )
      return [];

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
        case "appearance-settings":
        case "model-settings":
        case "profile-settings":
          return onOpenSettings(settingsActionPages[action.id]);
        case "customize-settings":
          return onOpenCustomize();
        case "reload-window":
          return window.location.reload();
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
        icon: actionIcons[action.id],
        meta: keys.length === 0 ? undefined : <Kbd keys={keys} plain />,
        run,
      },
    ];
  });

  const visibleActions = actions.filter(
    (action) => (tab === "all" || tab === action.group) && matches(action, query),
  );

  const rows = [
    ...(includesAgents ? sessions.map((session) => session.id) : []),
    ...(tab === "agents" ? [] : visibleActions.map((action) => action.key)),
  ];

  const run = (action: () => void): void => {
    onOpenChange(false);
    action();
  };

  const chatsPending = searchingAgents
    ? sessionSearch.data === undefined
    : recentSessions === undefined;

  const emptyMessage = (): string => {
    if (includesAgents && chatsPending) return "Loading chats…";

    if (tab === "agents")
      return searchingAgents ? `No chats match "${query.trim()}"` : "No chats yet";

    if (tab === "all") return `Nothing matches "${query.trim()}"`;

    return `No ${tab} match this search.`;
  };

  const chatGroup = sessions.length > 0 && (
    <ChatGroup
      heading={searchingAgents ? "Chats" : "Recent chats"}
      sessions={sessions}
      onOpen={(sessionId) => run(() => onOpenSession(sessionId))}
    />
  );

  const actionGroup = visibleActions.length > 0 && (
    <Command.Group heading={tab === "all" ? "Actions" : tabLabel(tab)}>
      {visibleActions.map((action) => (
        <Command.Item
          key={action.key}
          value={action.key}
          leading={<Icon name={action.icon} size="md" />}
          meta={action.meta}
          onClick={() => run(action.run)}
        >
          {action.label}
        </Command.Item>
      ))}
    </Command.Group>
  );

  return (
    <Command.Root open={open} onOpenChange={onOpenChange}>
      <Command.Trigger render={trigger} />
      <Command.Popup
        title="Search chats and actions"
        items={rows}
        value={query}
        onValueChange={(value) => setQuery(value)}
      >
        <Command.Input
          aria-label="Search"
          placeholder="Search chats and actions…"
          trailing={<Kbd keys={clientActionKeys(clientActions.search, mac)} plain />}
        />
        <Tabs.Root
          variant="plain"
          value={tab}
          xstyle={[styles.tabsBar, hairline.blockEnd]}
          onValueChange={(value) => {
            if (amongOptions(value, TABS)) setTab(value);
          }}
        >
          <Tabs.List aria-label="Search categories" xstyle={styles.tabs}>
            {TABS.map((option) => (
              <Tabs.Tab key={option} value={option} variant="bare" xstyle={[text.base, styles.tab]}>
                {tabLabel(option)}
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.Root>
        <div role="status" {...props(srOnly)}>
          {`${String(rows.length)} ${rows.length === 1 ? "result" : "results"}`}
        </div>
        <Command.List aria-label={tabLabel(tab)}>
          <Command.Empty aria-busy={includesAgents && chatsPending}>{emptyMessage()}</Command.Empty>
          {includesAgents && chatGroup}
          {tab !== "agents" && actionGroup}
        </Command.List>
        <PaletteLegend />
      </Command.Popup>
    </Command.Root>
  );
}
