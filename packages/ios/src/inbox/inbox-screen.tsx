import { router, useFocusEffect } from "expo-router";
import { Stack } from "expo-router/stack";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { css, html } from "react-strict-dom";
import type { SessionInfo } from "@nyte-ai/protocol";
import { useHost } from "../connection/host-context.tsx";
import { SessionRow } from "../chat/session-row.tsx";
import { Composer } from "../chat/composer.tsx";
import {
  hasFailed,
  isActive,
  needsAttention,
  needsInput,
  useSessionList,
} from "../chat/sessions.ts";
import { useWorkLiveActivitySync } from "../activity/live-activity.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { GlassButton } from "../ui/glass-button.tsx";
import { SectionHeader } from "../ui/section-header.tsx";
import { FilterGrid } from "./filter-grid.tsx";
import { useDateSections, useFilterCards, useTwoLinePreview } from "../settings/preferences.ts";
import { controls, useTheme, spacing, textStyles, tokens } from "../theme.ts";

// The menu order is the source of truth; the type and the labels derive from it.
const filterOrder = ["all", "attention", "working", "pinned"] as const;

type Filter = (typeof filterOrder)[number];

const filterLabels: Record<Filter, string> = {
  all: "All Agents",
  attention: "Needs you",
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
          onPress={() => router.push(`/chat/${session.sessionId}`)}
        />
      ))}
    </>
  );
}

export function InboxScreen() {
  const theme = useTheme();
  const { client, connection } = useHost();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
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
  const activeFilter = filterCards ? filter : "all";
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

  // Rows must move from Working to Finished; poll quietly while any run is live.
  const workingCount = working.length;
  useEffect(() => {
    if (workingCount === 0) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      reload();
    }, 10_000);
    return () => clearInterval(timer);
  }, [workingCount, reload]);

  return (
    <View style={{ flex: 1 }}>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button
          icon="laptopcomputer"
          accessibilityLabel={`${connection.name} settings`}
          onPress={() => router.push("/settings")}
        />
      </Stack.Toolbar>
      <Stack.Toolbar placement="right"></Stack.Toolbar>
      <Stack.SearchBar
        placement="automatic"
        allowToolbarIntegration={false}
        hideWhenScrolling
        placeholder="Search agents"
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
          paddingBottom: controls.composerBar + insets.bottom + spacing.xl,
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
        {list.kind === "ready" && search === "" && filterCards ? (
          <FilterGrid
            cards={[
              {
                id: "all",
                label: filterLabels.all,
                icon: "square.stack",
                tint: theme.muted,
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
                tint: theme.success,
                count: pinned.length,
              },
            ]}
            active={filter}
            onSelect={setFilter}
          />
        ) : null}
        {list.kind === "loading" && !pulled && (
          <html.div style={styles.state}>
            <ActivityIndicator color={theme.muted} />
          </html.div>
        )}
        {list.kind === "failed" && (
          <EmptyState
            title="Couldn't load agents"
            description={list.message}
            systemImage="laptopcomputer.slash"
          >
            <html.div style={styles.stateActions}>
              <GlassButton label="Try again" onPress={refresh} />
              <GlassButton
                label="Connection"
                systemImage="gearshape"
                onPress={() => router.push("/settings")}
              />
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
                    ? "Describe a task below. Your Mac runs it and it shows up here."
                    : "Other agents are hidden by this filter."
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
                title={group.title}
                sessions={group.sessions}
                now={now}
                first={index === 0}
                twoLines={twoLinePreview}
              />
            ))
          ))}
        {list.kind === "ready" && list.next !== undefined && (
          <html.button onClick={() => void more()} disabled={busy} style={styles.showMore}>
            <html.span style={textStyles.secondary}>{busy ? "Loading…" : "Show more"}</html.span>
          </html.button>
        )}
        {error !== undefined && (
          <html.p role="alert" style={[textStyles.error, styles.listError]}>
            {error}
          </html.p>
        )}
      </ScrollView>
      <KeyboardStickyView style={{ position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 1 }}>
        <Composer
          target={{ kind: "new" }}
          placeholder="Ask anything"
          backdrop="background"
          gutters={{ left: insets.left + spacing.gutter, right: insets.right + spacing.gutter }}
          onWorkspaceChange={reload}
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
