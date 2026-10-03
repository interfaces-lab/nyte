import { Tabs } from "@nyte-ai/ui/tabs";
import { props } from "@stylexjs/stylex";
// oxlint-disable-next-line no-restricted-imports -- the shortcut follows the open state
import { useEffect, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import type { SessionId, SessionInfo } from "@nyte-ai/protocol";
import { Command } from "@nyte-ai/ui/command";
import { Icon, type IconName } from "@nyte-ai/ui/icon";
import { formatTimeAgo } from "../components/ui.tsx";
import { StatusGlyph } from "./status-glyph.tsx";
import { srOnly } from "@nyte-ai/ui/a11y.stylex";
import { Kbd } from "@nyte-ai/ui/kbd";
import { macPlatform } from "../platform.ts";
import { sessionActivityMark } from "../session-activity.ts";
import { useOptimisticSessionIds } from "../use-outbox.ts";
import { isOption, sessionsForNavigation } from "./sidebar-view.ts";
import { useSessionSearch } from "../queries.ts";
import { PaletteLegend } from "./palette-legend.tsx";
import { searchPaletteStyles as styles } from "./search-palette.stylex.ts";
import { sessionReadState } from "../session-read-state.ts";
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
  /** The sidebar's chat rows, in its order. Undefined while they load. */
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
  recentSessions,
  onOpenChange,
  onOpenSession,
  onNewChat,
  onOpenFolder,
  onOpenHome,
  onOpenSettings,
  onOpenCustomize,
}: SearchPaletteProps): ReactElement {
  const optimisticSessions = useOptimisticSessionIds();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<PaletteTab>("all");
  const includesAgents = tab === "all" || tab === "agents";
  const searchingAgents = includesAgents && query.trim() !== "";
  const sessionSearch = useSessionSearch(query, open && sessionQueriesAvailable && searchingAgents);

  const sessions = searchingAgents
    ? sessionsForNavigation(sessionSearch.data?.items ?? [])
    : (recentSessions ?? []);

  const mac = macPlatform(platform);
  const settingsSections = settingsSectionGroups().flat();

  const actions: readonly PaletteAction[] = Object.values(clientActions).flatMap((action) => {
    if (!("palette" in action)) return [];

    if (action.id === "model-settings" && !settingsSections.includes("providers")) return [];

    if (action.id === "profile-settings" && !settingsSections.includes("profile")) return [];

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
        case "profile-settings":
          return onOpenSettings("profile");
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

  const rows = [
    ...(includesAgents ? sessions.map((session) => session.sessionId) : []),
    ...(tab === "agents" ? [] : visibleActions.map((action) => action.key)),
  ];

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

  const chatsPending = searchingAgents ? sessionSearch.isPending : recentSessions === undefined;

  const emptyMessage = (): string => {
    if (includesAgents && (!sessionQueriesAvailable || chatsPending)) return "Loading chats…";

    if (searchingAgents && sessionSearch.isError) return "Couldn’t load chats. Try again.";

    if (tab === "agents")
      return searchingAgents ? `No chats match "${query.trim()}"` : "No chats yet";

    if (tab === "all") return `Nothing matches "${query.trim()}"`;

    return `No ${tab} match this search.`;
  };

  const chatGroup = sessions.length > 0 && (
    <Command.Group heading={searchingAgents ? "Chats" : "Recent chats"}>
      {sessions.map((session) => (
        <Command.Item
          key={session.sessionId}
          value={session.sessionId}
          leading={
            <StatusGlyph
              session={session}
              mark={sessionActivityMark(session, optimisticSessions.has(session.sessionId))}
            />
          }
          meta={formatTimeAgo(session.lastActivityAt)}
          onSelect={() =>
            run(() => {
              sessionReadState.markRead(session);
              onOpenSession(session.sessionId);
            })
          }
        >
          {sessionTitle(session)}
        </Command.Item>
      ))}
    </Command.Group>
  );

  const actionGroup = visibleActions.length > 0 && (
    <Command.Group heading={tab === "all" ? "Actions" : tabLabel(tab)}>
      {visibleActions.map((action) => (
        <Command.Item
          key={action.key}
          value={action.key}
          leading={<Icon name={action.icon} size={16} />}
          meta={action.meta}
          onSelect={() => run(action.run)}
        >
          {action.label}
        </Command.Item>
      ))}
    </Command.Group>
  );

  return (
    <Command.Root open={open} onOpenChange={changeOpen}>
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
          trailing={<Kbd keys={clientActionKeys(clientActions.search, mac)} />}
        />
        <Tabs.Root
          variant="pill"
          value={tab}
          onValueChange={(value) => {
            if (isOption(value, TABS)) setTab(value);
          }}
        >
          <Tabs.List aria-label="Search categories" xstyle={styles.tabs}>
            {TABS.map((option) => (
              <Tabs.Tab key={option} value={option}>
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
