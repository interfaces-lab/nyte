import { router, useFocusEffect } from "expo-router";
import { Stack } from "expo-router/stack";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { css, html } from "react-strict-dom";
import type { SessionInfo } from "@nyte-ai/protocol";
import { useHost } from "../connection/host-context.tsx";
import { SessionRow } from "../chat/session-row.tsx";
import { Composer } from "../chat/composer.tsx";
import { isActive, needsAttention, useSessionList } from "../chat/sessions.ts";
import { useWorkLiveActivitySync } from "../activity/live-activity.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { SectionHeader } from "../ui/section-header.tsx";
import { controls, useTheme, spacing, textStyles, tokens } from "../theme.ts";

type Filter = "all" | "attention" | "working" | "pinned";

const filterLabels: Record<Filter, string> = {
  all: "All Agents",
  attention: "Needs input",
  working: "Working",
  pinned: "Pinned",
};

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
}: {
  title: string;
  sessions: readonly SessionInfo[];
  now: number;
  first: boolean;
}) {
  if (sessions.length === 0) return null;
  return (
    <>
      <SectionHeader label={title} first={first} />
      {sessions.map((session, index) => (
        <SessionRow
          key={session.sessionId}
          session={session}
          now={now}
          last={index === sessions.length - 1}
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
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const { list, busy, error, refresh, reload, more } = useSessionList(client, query.trim());
  // Latched by each pull; the spinner shows only while the load it asked for runs.
  const [pulling, setPulling] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const sessions = (list.kind === "ready" ? list.sessions : []).filter(
    (session) => !session.archived,
  );
  const working = sessions.filter(isActive);
  const attention = sessions.filter((session) => needsAttention(session) && !isActive(session));
  const pinned = sessions.filter(
    (session) => session.pinned && !isActive(session) && !needsAttention(session),
  );
  const rest = sessions.filter(
    (session) => !session.pinned && !isActive(session) && !needsAttention(session),
  );
  const today = rest.filter((session) => isToday(session, now));
  const earlier = rest.filter((session) => !isToday(session, now));

  const filtered =
    filter === "attention"
      ? sessions.filter(needsAttention)
      : filter === "working"
        ? sessions.filter(isActive)
        : filter === "pinned"
          ? sessions.filter((session) => session.pinned)
          : sessions;

  useWorkLiveActivitySync(working);

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
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu
          icon="line.3.horizontal.decrease"
          accessibilityLabel="Filter agents"
          separateBackground
          inline
        >
          {(Object.keys(filterLabels) as Filter[]).map((key) => (
            <Stack.Toolbar.MenuAction
              key={key}
              isOn={filter === key}
              onPress={() => setFilter(key)}
            >
              {filterLabels[key]}
            </Stack.Toolbar.MenuAction>
          ))}
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      <Stack.SearchBar
        placement="automatic"
        allowToolbarIntegration={false}
        hideWhenScrolling
        placeholder="Search agents"
        onChangeText={(event) => setQuery(event.nativeEvent.text)}
      />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          flexGrow: 1,
          paddingTop: spacing.xs,
          paddingBottom: controls.composerHeight + insets.bottom + spacing.xl,
        }}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl
            tintColor={theme.muted}
            refreshing={pulling && list.kind === "loading"}
            onRefresh={() => {
              setPulling(true);
              setNow(Date.now());
              refresh();
            }}
          />
        }
      >
        {list.kind === "loading" && (
          <html.div style={styles.state}>
            <ActivityIndicator color={theme.muted} />
          </html.div>
        )}
        {list.kind === "failed" && (
          <EmptyState title="Couldn't load agents" description={list.message} />
        )}
        {list.kind === "ready" &&
          (filtered.length === 0 ? (
            <EmptyState
              title={query.trim() === "" ? "No agents yet" : "No matching agents"}
              description={
                query.trim() === ""
                  ? "Describe a task below. Your Mac runs it and it shows up here."
                  : "Try another name."
              }
              systemImage="square.stack"
            />
          ) : filter === "all" ? (
            <>
              <SessionSection title="Needs input" sessions={attention} now={now} first />
              <SessionSection
                title="Working"
                sessions={working}
                now={now}
                first={attention.length === 0}
              />
              <SessionSection
                title="Pinned"
                sessions={pinned}
                now={now}
                first={attention.length === 0 && working.length === 0}
              />
              <SessionSection
                title="Today"
                sessions={today}
                now={now}
                first={attention.length === 0 && working.length === 0 && pinned.length === 0}
              />
              <SessionSection
                title="Earlier"
                sessions={earlier}
                now={now}
                first={
                  attention.length === 0 &&
                  working.length === 0 &&
                  pinned.length === 0 &&
                  today.length === 0
                }
              />
            </>
          ) : (
            <SessionSection title={filterLabels[filter]} sessions={filtered} now={now} first />
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
      <KeyboardStickyView
        offset={{ opened: insets.bottom + spacing.xs }}
        style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}
      >
        <Composer target={{ kind: "new" }} placeholder="Ask anything" />
      </KeyboardStickyView>
    </View>
  );
}

const styles = css.create({
  state: { paddingBlock: spacing.xxl, alignItems: "center" },
  listError: { margin: 0, paddingInline: spacing.gutter },
  showMore: {
    alignItems: "center",
    minHeight: controls.touchTarget,
    justifyContent: "center",
    borderWidth: 0,
    backgroundColor: { default: "transparent", ":active": tokens.fill },
  },
});
