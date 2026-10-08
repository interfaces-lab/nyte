import { router, useFocusEffect } from "expo-router";
import { Stack } from "expo-router/stack";
import { useCallback, useRef, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import type { SearchBarCommands } from "react-native-screens";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { css, html } from "react-strict-dom";
import type { SessionInfo } from "@nyte-ai/protocol";
import { useHost } from "../connection/host-context.tsx";
import { SessionRow } from "../chat/session-row.tsx";
import { Composer } from "../chat/composer.tsx";
import { WorkspacePicker } from "../chat/workspace-menu.tsx";
import {
  hasFailed,
  isActive,
  needsAttention,
  needsInput,
  useSessionList,
} from "../chat/sessions.ts";
import { useWorkLiveActivitySync } from "../activity/live-activity.tsx";
import { useMountEffect } from "../use-mount-effect.ts";
import { EmptyState } from "../ui/empty-state.tsx";
import { GlassButton } from "../ui/glass-button.tsx";
import { SectionHeader } from "../ui/section-header.tsx";
import { SessionRowsSkeleton } from "../ui/skeleton.tsx";
import { FilterGrid } from "./filter-grid.tsx";
import { AccountButton } from "./account-button.tsx";
import { useDateSections, useFilterCards, useTwoLinePreview } from "../settings/preferences.ts";
import { controls, useTheme, spacing, textStyles, tokens } from "../theme.ts";

// The menu order is the source of truth; the type and the labels derive from it.
const filterOrder = ["all", "attention", "working", "pinned"] as const;

type Filter = (typeof filterOrder)[number];

const filterLabels: Record<Filter, string> = {
  all: "All Agents",
  attention: "Needs attention",
  working: "Working",
  pinned: "Pinned",
};

/** Typing in the search field must not spend one host request per keystroke. */
const SEARCH_DEBOUNCE_MS = 250;

function isToday(session: SessionInfo, now: number): boolean {
  const then = new Date(session.lastActivityAt);
  const date = new Date(now);

  return (
    then.getFullYear() === date.getFullYear() &&
    then.getMonth() === date.getMonth() &&
    then.getDate() === date.getDate()
  );
}

function SessionSection({
  title,
  sessions,
  now,
  first,
  twoLines,
}: {
  title?: string;
  sessions: readonly SessionInfo[];
  now: number;
  first: boolean;
  twoLines: boolean;
}) {
  return (
    <>
      {title === undefined ? null : <SectionHeader label={title} first={first} />}
      {sessions.map((session, index) => (
        <SessionRow
          key={session.sessionId}
          session={session}
          now={now}
          last={index === sessions.length - 1}
          twoLines={twoLines}
        />
      ))}
    </>
  );
}

export function InboxScreen() {
  const theme = useTheme();
  const { client } = useHost();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");
  const [searchActive, setSearchActive] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const searchBar = useRef<SearchBarCommands>(null);
  const workspacePending = useRef<Promise<void> | undefined>(undefined);
  const [workspaceEpoch, setWorkspaceEpoch] = useState(0);
  const [creating, setCreating] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const { list, busy, error, refresh, reload, more } = useSessionList(client, search);
  // A pull is the only load that blanks the rows, so the spinner belongs to it
  // alone; returning to the app reloads in place and never sets loading.
  const [pulled, setPulled] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [filterCards] = useFilterCards();
  const [dateSections] = useDateSections();
  const [twoLinePreview] = useTwoLinePreview();

  const sessions = (list.kind === "ready" ? list.sessions : []).filter(
    (session) => !session.archived,
  );

  const working = sessions.filter(isActive);
  const attention = sessions.filter((session) => needsInput(session) && !isActive(session));
  const failed = sessions.filter((session) => hasFailed(session) && !isActive(session));
  const settled = sessions.filter((session) => !isActive(session) && !needsAttention(session));
  const pinned = settled.filter((session) => session.pinned);
  const rest = settled.filter((session) => !session.pinned);

  // One table drives the sections, the filter menu, and the empty state, so a
  // row can never sit in a section the filter of the same name hides. Groups
  // with no filter of their own show only in the unfiltered list. Settled
  // agents split by day only while the date sections are on; otherwise they
  // run together under no heading at all.
  const settledGroups: readonly { title?: string; sessions: readonly SessionInfo[] }[] =
    dateSections
      ? [
          { title: "Today", sessions: rest.filter((session) => isToday(session, now)) },
          { title: "Earlier", sessions: rest.filter((session) => !isToday(session, now)) },
        ]
      : [{ sessions: rest }];

  const groups: readonly {
    title?: string;
    filter?: Exclude<Filter, "all">;
    sessions: readonly SessionInfo[];
  }[] = [
    { title: "Needs input", filter: "attention", sessions: attention },
    { title: "Failed", filter: "attention", sessions: failed },
    { title: "Working", filter: "working", sessions: working },
    { title: "Pinned", filter: "pinned", sessions: pinned },
    ...settledGroups,
  ];

  // Hiding the filter cards also hides the only way back out of a filter, so
  // the list falls back to showing everything while they are off.
  const activeFilter = filterCards && !searchActive ? filter : "all";

  const visible = groups.filter(
    (group) =>
      group.sessions.length > 0 && (activeFilter === "all" || group.filter === activeFilter),
  );

  useWorkLiveActivitySync(working, attention);

  // Returning to the list rechecks the host without blanking the rows.
  useFocusEffect(
    useCallback(() => {
      reload();
      setNow(Date.now());
    }, [reload]),
  );

  // Relative times age on their own; the query polls for data changes itself.
  useMountEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000);

    return () => {
      clearInterval(timer);
      clearTimeout(searchTimer.current);
    };
  });

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: "Inbox" }} />
      <AccountButton />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon="magnifyingglass"
          accessibilityLabel="Search agents"
          onPress={() => searchBar.current?.focus()}
          separateBackground
        />
        <Stack.Toolbar.View>
          <View style={{ width: controls.touchTarget, height: controls.touchTarget }}>
            <WorkspacePicker
              client={client}
              toolbar
              busy={creating}
              onSettings={() => router.navigate("/settings")}
              onSelecting={(pending) => {
                workspacePending.current = pending;
                void pending
                  .finally(() => {
                    if (workspacePending.current === pending) workspacePending.current = undefined;
                  })
                  .catch(() => undefined);
              }}
              onWorkspaceChange={() => {
                setWorkspaceEpoch((epoch) => epoch + 1);
                reload();
              }}
            />
          </View>
        </Stack.Toolbar.View>
      </Stack.Toolbar>
      <Stack.SearchBar
        ref={searchBar}
        placement="automatic"
        allowToolbarIntegration={false}
        hideWhenScrolling
        placeholder="Search agents"
        onFocus={() => setSearchActive(true)}
        onCancelButtonPress={() => {
          clearTimeout(searchTimer.current);
          setSearch("");
          setSearchActive(false);
        }}
        onChangeText={(event) => {
          const text = event.nativeEvent.text.trim();
          clearTimeout(searchTimer.current);
          searchTimer.current = setTimeout(() => setSearch(text), SEARCH_DEBOUNCE_MS);
        }}
      />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: spacing.xs,
          paddingBottom: (searchActive ? 0 : controls.composerBar) + insets.bottom + spacing.xl,
        }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl
            tintColor={theme.muted}
            refreshing={pulled && list.kind === "loading"}
            onRefresh={() => {
              setPulled(true);
              setNow(Date.now());
              refresh();
            }}
          />
        }
      >
        {list.kind === "ready" && !searchActive && search === "" && filterCards ? (
          <FilterGrid
            cards={[
              {
                id: "all",
                label: filterLabels.all,
                icon: "paperplane",
                tint: theme.agentAccent,
                count: sessions.length,
              },
              {
                id: "attention",
                label: filterLabels.attention,
                icon: "bell.badge",
                tint: theme.warning,
                count: attention.length + failed.length,
              },
              {
                id: "working",
                label: filterLabels.working,
                icon: "circle.grid.cross",
                tint: theme.accent,
                count: working.length,
              },
              {
                id: "pinned",
                label: filterLabels.pinned,
                icon: "pin",
                tint: theme.pinnedAccent,
                count: pinned.length,
              },
            ]}
            active={filter}
            onSelect={setFilter}
          />
        ) : null}
        {list.kind === "loading" && !pulled && <SessionRowsSkeleton />}
        {list.kind === "failed" && (
          <EmptyState
            title="Couldn't load agents"
            description={list.message}
            systemImage="laptopcomputer.slash"
          >
            <html.div style={styles.stateActions}>
              <GlassButton label="Try again" onPress={refresh} />
              <GlassButton label="Connection" systemImage="gearshape" href="/settings" />
            </html.div>
          </EmptyState>
        )}
        {list.kind === "ready" &&
          (visible.length === 0 ? (
            <EmptyState
              title={
                search !== ""
                  ? "No matching agents"
                  : activeFilter === "all"
                    ? "No agents yet"
                    : `Nothing in ${filterLabels[activeFilter]}`
              }
              description={
                search !== ""
                  ? "Try another name."
                  : activeFilter === "all"
                    ? "Send a message to start a chat."
                    : undefined
              }
              systemImage="square.stack"
            >
              {search === "" && activeFilter !== "all" ? (
                <html.div style={styles.stateActions}>
                  <GlassButton label="Show all agents" onPress={() => setFilter("all")} />
                </html.div>
              ) : null}
            </EmptyState>
          ) : (
            visible.map((group, index) => (
              <SessionSection
                key={group.title ?? "settled"}
                title={group.title ?? "Conversations"}
                sessions={group.sessions}
                now={now}
                first={index === 0}
                twoLines={twoLinePreview}
              />
            ))
          ))}
        {list.kind === "ready" && list.next !== undefined && (
          <html.button
            onClick={() => {
              if (!busy) more();
            }}
            aria-busy={busy}
            style={styles.showMore}
          >
            <html.span aria-live="polite" style={textStyles.secondary}>
              {busy ? "Loading…" : "Show More"}
            </html.span>
          </html.button>
        )}
        {error !== undefined && (
          <html.p role="alert" style={[textStyles.error, styles.listError]}>
            {error}
          </html.p>
        )}
      </ScrollView>
      <KeyboardStickyView
        pointerEvents={searchActive ? "none" : "auto"}
        style={{
          display: searchActive ? "none" : "flex",
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 1,
        }}
      >
        <Composer
          target={{ kind: "new" }}
          placeholder="Ask anything"
          gutters={{ left: insets.left + spacing.gutter, right: insets.right + spacing.gutter }}
          workspacePending={workspacePending}
          workspaceEpoch={workspaceEpoch}
          onBusyChange={setCreating}
        />
      </KeyboardStickyView>
    </View>
  );
}

const styles = css.create({
  state: {
    display: "flex",
    flexDirection: "column",
    paddingBlock: spacing.xxl,
    alignItems: "center",
  },
  stateActions: {
    display: "flex",
    flexDirection: "row",
    gap: spacing.sm,
    paddingTop: spacing.md,
  },
  listError: { margin: 0, paddingInline: spacing.gutter },
  showMore: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    minHeight: controls.touchTarget,
    justifyContent: "center",
    borderWidth: 0,
    backgroundColor: { default: "transparent", ":active": tokens.fill },
  },
});
