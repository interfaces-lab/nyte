import { sessionMark, type SessionMark } from "@nyte-ai/core/client";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Keyboard,
  Modal,
  ScrollView,
  View,
} from "react-native";
import { Button, Host, Text } from "@expo/ui/swift-ui";
import {
  buttonStyle,
  contentShape,
  font,
  foregroundStyle,
  frame,
  shapes,
} from "@expo/ui/swift-ui/modifiers";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SymbolView } from "expo-symbols";
import { css, html } from "react-strict-dom";
import type { NyteClient } from "@nyte-ai/client";
import type { Page, RunId, SessionId, SessionInfo } from "@nyte-ai/protocol";
import { ChatScreen } from "./chat-screen.tsx";
import { ChangesScreen } from "./changes-screen.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { GlassButton } from "../ui/glass-button.tsx";
import { describeHostError, displayAddress, type Connection } from "../connection/connection.ts";
import { useRemoteChat } from "./remote-chat.ts";
import { controls, nativeTheme, radii, spacing, textStyles, tokens, typography } from "../theme.ts";
type Destination =
  | { kind: "list" }
  | { kind: "chat"; sessionId: SessionId }
  | { kind: "changes"; sessionId: SessionId; runId: RunId | undefined };

const statusLabels: Record<SessionMark, string> = {
  waiting: "Waiting",
  retry: "Retrying",
  working: "Working",
  failed: "Failed",
  idle: "Ready",
};

type SessionList =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "ready"; page: Page<SessionInfo> };

export function ChatsScreen({
  client,
  connection,
  onDisconnect,
}: {
  client: NyteClient;
  connection: Connection;
  onDisconnect: () => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const [list, setList] = useState<SessionList>({ kind: "loading" });
  const [destination, setDestination] = useState<Destination>({ kind: "list" });
  const selected = destination.kind === "list" ? undefined : destination.sessionId;
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const activeClient = useRef<NyteClient | undefined>(undefined);
  const listVersion = useRef(0);
  const chat = useRemoteChat(client, selected);

  useEffect(() => {
    let current = true;
    void client.sessions
      .list({ parent: null, limit: 50 })
      .then((page) => {
        if (current) setList({ kind: "ready", page });
      })
      .catch((cause: unknown) => {
        if (current) setList({ kind: "failed", message: describeHostError(cause) });
      });
    return () => {
      current = false;
    };
  }, [client, revision]);

  // The list is only as fresh as its last fetch, so returning to the app rechecks the host.
  useEffect(() => {
    activeClient.current = client;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => {
      activeClient.current = undefined;
      subscription.remove();
    };
  }, [client]);

  async function createConversation() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const session = await client.sessions.create({ name: "New conversation" });
      if (activeClient.current === client)
        setDestination({ kind: "chat", sessionId: session.sessionId });
    } catch (cause) {
      if (activeClient.current === client) setError(describeHostError(cause));
    } finally {
      if (activeClient.current === client) setBusy(false);
    }
  }

  async function more() {
    if (busy || list.kind !== "ready" || !list.page.next) return;
    const version = listVersion.current;
    setBusy(true);
    try {
      const page = await client.sessions.list({ parent: null, cursor: list.page.next, limit: 50 });
      if (activeClient.current !== client || listVersion.current !== version) return;
      setList({ kind: "ready", page: { ...page, items: [...list.page.items, ...page.items] } });
    } catch (cause) {
      if (activeClient.current === client && listVersion.current === version)
        setError(describeHostError(cause));
    } finally {
      if (activeClient.current === client) setBusy(false);
    }
  }

  function refresh() {
    listVersion.current += 1;
    setList({ kind: "loading" });
    setError(undefined);
    setRevision((value) => value + 1);
  }

  function back() {
    setDestination({ kind: "list" });
    refresh();
  }

  // Disconnecting deletes the saved token, so reconnecting means copying it from the Mac again.
  function disconnect() {
    Alert.alert(
      `Disconnect from ${connection.name}?`,
      "To connect again, you'll need the address and token from your Mac.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: () =>
            void onDisconnect().catch(() =>
              setError("Couldn't remove the saved connection. Try again."),
            ),
        },
      ],
    );
  }

  if (destination.kind !== "list") {
    if (chat.state)
      return (
        <>
          <ChatScreen
            {...chat}
            state={chat.state}
            client={client}
            onSelect={chat.selectModel}
            onSend={chat.send}
            onStop={chat.stop}
            onReply={chat.reply}
            onReview={() => {
              Keyboard.dismiss();
              setDestination({
                kind: "changes",
                sessionId: destination.sessionId,
                runId: chat.state?.run?.runId,
              });
            }}
            onBack={back}
          />
          <Modal
            visible={destination.kind === "changes"}
            presentationStyle="fullScreen"
            onRequestClose={() =>
              setDestination({ kind: "chat", sessionId: destination.sessionId })
            }
          >
            {destination.kind === "changes" ? (
              <ChangesScreen
                client={client}
                sessionId={destination.sessionId}
                runId={destination.runId}
                onBack={() => setDestination({ kind: "chat", sessionId: destination.sessionId })}
              />
            ) : null}
          </Modal>
        </>
      );
    return (
      <html.div style={[styles.centered, styles.topInset(insets.top)]}>
        {chat.error ? (
          <html.p role="alert" style={[textStyles.error, styles.centeredText]}>
            {chat.error}
          </html.p>
        ) : (
          <ActivityIndicator color={nativeTheme.muted} />
        )}
        <GlassButton label="Back to chats" onPress={back} />
      </html.div>
    );
  }

  const status =
    list.kind === "loading"
      ? { label: "Checking…", style: styles.statusChecking }
      : list.kind === "failed"
        ? { label: "Unreachable", style: styles.statusDown }
        : { label: "Connected", style: styles.statusUp };
  const now = Date.now();

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1 }}
        contentInsetAdjustmentBehavior="automatic"
      >
        <html.div style={styles.page}>
          <html.div style={styles.header}>
            <html.h1 style={[textStyles.heading, styles.text]}>Chats</html.h1>
            <GlassButton
              label="New chat"
              systemImage="plus"
              disabled={busy || list.kind !== "ready"}
              onPress={() => void createConversation()}
              iconOnly
              prominent
            />
          </html.div>
          <html.div style={styles.host}>
            <html.div style={styles.hostText}>
              <html.div style={styles.hostTop}>
                <html.span style={[textStyles.title, styles.hostName]}>{connection.name}</html.span>
                <html.div style={styles.status} aria-live="polite">
                  <html.div style={[styles.statusDot, status.style]} />
                  <html.span style={textStyles.caption}>{status.label}</html.span>
                </html.div>
              </html.div>
              <html.span style={[textStyles.caption, styles.numericText]}>
                {displayAddress(connection)}
              </html.span>
            </html.div>
            <Host
              matchContents={{ horizontal: true }}
              style={{ height: controls.touchTarget }}
              colorScheme="dark"
              ignoreSafeArea="all"
            >
              {/* The label's own frame is the hit region, so the text ends on the rail. */}
              <Button role="destructive" onPress={disconnect} modifiers={[buttonStyle("plain")]}>
                <Text
                  modifiers={[
                    font({ size: typography.title.fontSize }),
                    foregroundStyle(nativeTheme.danger),
                    frame({
                      minWidth: controls.touchTarget,
                      minHeight: controls.touchTarget,
                      alignment: "topTrailing",
                    }),
                    contentShape(shapes.rectangle()),
                  ]}
                >
                  Disconnect
                </Text>
              </Button>
            </Host>
          </html.div>
          {list.kind === "loading" && (
            <html.div style={styles.state}>
              <ActivityIndicator color={nativeTheme.muted} />
            </html.div>
          )}
          {list.kind === "failed" && (
            <html.div role="alert">
              <EmptyState title="Couldn't load chats" description={list.message} />
            </html.div>
          )}
          {list.kind === "ready" &&
            (list.page.items.length === 0 ? (
              <EmptyState
                title="No chats yet"
                description={`Chats on ${connection.name} show up here.`}
              >
                <GlassButton
                  label="New chat"
                  disabled={busy}
                  onPress={() => void createConversation()}
                  prominent
                />
              </EmptyState>
            ) : (
              <html.div style={styles.list}>
                {list.page.items.map((session) => (
                  <html.button
                    key={session.sessionId}
                    disabled={busy}
                    onClick={() => setDestination({ kind: "chat", sessionId: session.sessionId })}
                    style={styles.row}
                  >
                    <html.div style={styles.rowInner}>
                      <html.div style={styles.rowText}>
                        <html.span style={[textStyles.title, styles.rowTitle]}>
                          {session.name || "Untitled conversation"}
                        </html.span>
                        <html.span
                          style={[textStyles.caption, styles.preview, styles[sessionMark(session)]]}
                        >
                          {statusLabels[sessionMark(session)]}
                        </html.span>
                      </html.div>
                      <html.div style={styles.rowTrailing}>
                        <html.span style={[textStyles.caption, styles.rowTime]}>
                          {formatActivity(session.lastActivityAt, now)}
                        </html.span>
                        <SymbolView
                          name="chevron.right"
                          size={controls.iconSm}
                          tintColor={nativeTheme.muted}
                        />
                      </html.div>
                    </html.div>
                  </html.button>
                ))}
              </html.div>
            ))}
          {list.kind === "ready" && list.page.next && (
            <GlassButton label="Load more" disabled={busy} onPress={() => void more()} />
          )}
        </html.div>
      </ScrollView>
      {/* Errors from New chat or Disconnect must stay visible however far the list scrolls. */}
      <html.div style={[styles.footer, styles.bottomInset(insets.bottom)]}>
        {error && (
          <html.p role="alert" style={[textStyles.error, styles.text]}>
            {error}
          </html.p>
        )}
        <GlassButton
          label="Refresh"
          systemImage="arrow.clockwise"
          disabled={busy || list.kind === "loading"}
          onPress={refresh}
          fullWidth
        />
      </html.div>
    </View>
  );
}

function formatActivity(at: number, now: number): string {
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return "Now";
  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${String(hours)}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${String(days)}d`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const styles = css.create({
  waiting: { color: tokens.warning },
  retry: { color: tokens.accent },
  working: { color: tokens.accent },
  failed: { color: tokens.danger },
  idle: { color: tokens.muted },
  centered: {
    flexGrow: 1,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.lg,
    padding: spacing.xl,
  },
  topInset: (top: number) => ({ paddingTop: top + spacing.xl }),
  page: {
    flexGrow: 1,
    paddingInline: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    gap: spacing.lg,
  },
  header: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  text: { margin: 0 },
  centeredText: { margin: 0, textAlign: "center" },
  host: {
    display: "flex",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingBottom: spacing.sm,
  },
  hostText: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  hostTop: { display: "flex", flexDirection: "row", alignItems: "center", gap: spacing.sm },
  hostName: { flexShrink: 1, lineClamp: 1 },
  numericText: { fontVariant: "tabular-nums" },
  status: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    gap: spacing.xs,
  },
  statusDot: {
    width: controls.statusDot,
    height: controls.statusDot,
    borderRadius: radii.pill,
  },
  statusChecking: { backgroundColor: tokens.muted },
  statusDown: { backgroundColor: tokens.danger },
  statusUp: { backgroundColor: tokens.success },
  state: { paddingBlock: spacing.xxl, gap: spacing.md, alignItems: "center" },
  list: { display: "flex", flexDirection: "column" },
  row: {
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    borderWidth: 0,
    padding: 0,
    width: "100%",
    minHeight: controls.touchTarget,
    backgroundColor: { default: "transparent", ":active": tokens.surface },
  },
  rowInner: {
    display: "flex",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingBlock: spacing.md,
    borderBottomWidth: controls.borderWidth,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.border,
  },
  rowText: { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: spacing.xs },
  rowTrailing: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    minHeight: typography.title.lineHeight,
    gap: spacing.sm,
  },
  rowTime: { minWidth: controls.touchTarget, textAlign: "right", fontVariant: "tabular-nums" },
  rowTitle: {
    flexGrow: 1,
    flexShrink: 1,
    textAlign: "start",
    lineClamp: 1,
  },
  preview: {
    textAlign: "start",
    lineClamp: 2,
  },
  footer: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.sm,
    paddingInline: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: tokens.background,
  },
  bottomInset: (bottom: number) => ({ paddingBottom: bottom + spacing.sm }),
});
