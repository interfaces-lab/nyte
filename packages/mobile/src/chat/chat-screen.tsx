import { useCallback, useMemo, useRef, useState } from "react";
import { View, useWindowDimensions } from "react-native";
import { css, html } from "react-strict-dom";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { KeyboardStickyView } from "react-native-keyboard-controller";
import {
  KeyboardAwareLegendList,
  useKeyboardChatComposerInset,
  useKeyboardScrollToEnd,
} from "@legendapp/list/keyboard";
import type { LegendListRef } from "@legendapp/list/react-native";
import { isTerminalPhase } from "@nyte-ai/protocol";
import type { ReplyOutcome, SelectionReply } from "@nyte-ai/protocol";
import { waitingCall, type SessionState } from "@nyte-ai/client";
import type { FileChange } from "@nyte-ai/client";
import type { UserContent } from "./remote-chat.ts";
import { spacing, tokens, useTheme } from "../theme.ts";
import { EmptyState } from "../ui/empty-state.tsx";
import { GlassButton } from "../ui/glass-button.tsx";
import { WaitingSelection } from "./waiting-selection.tsx";
import { Composer } from "./composer.tsx";
import { ReviewStrip } from "./review-strip.tsx";
import { MessageRow, type ChatRow } from "./messages.tsx";
import { conversationLayout } from "./conversation-layout.ts";
import type { ConversationTurn } from "./turn-changes.ts";

type ChatScreenProps = {
  state: SessionState;
  streamingText: string;
  sending: boolean;
  error: string | undefined;
  onSend: (content: UserContent) => Promise<boolean>;
  onStop: () => void;
  onReply: (reply: SelectionReply) => Promise<ReplyOutcome | undefined>;
  changes: readonly FileChange[] | undefined;
  onAskMerge: () => void;
  onOpenReview: () => void;
  prefill: { text: string; nonce: number } | undefined;
};

export function ChatScreen({
  state,
  streamingText,
  sending,
  error,
  onSend,
  onStop,
  onReply,
  changes,
  onAskMerge,
  onOpenReview,
  prefill,
}: ChatScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // The glass header floats over the list; start the transcript below it.
  const headerHeight = insets.top + 44;
  const window = useWindowDimensions();
  // The list spans the window; rows and the composer share one measured column.
  const [viewportWidth, setViewportWidth] = useState(window.width);
  const layout = useMemo(
    () => conversationLayout(viewportWidth, { left: insets.left, right: insets.right }),
    [viewportWidth, insets.left, insets.right],
  );
  const listRef = useRef<LegendListRef>(null);
  const composerRef = useRef<View>(null);
  const [following, setFollowing] = useState(true);
  const [atEnd, setAtEnd] = useState(true);
  const [anchorIndex, setAnchorIndex] = useState<number>();
  const pendingAnchorScroll = useRef(false);
  const running = state.run !== undefined && !isTerminalPhase(state.run.phase);
  const stopping = state.run?.abortRequested === true;
  const waiting = waitingCall(state);
  // The jump pill doubles as the way back to an off-screen question.
  const answerable = waiting !== undefined;
  const { contentInsetEndAdjustment, onComposerLayout } = useKeyboardChatComposerInset(
    listRef,
    composerRef,
  );
  const { freeze, scrollMessageToEnd } = useKeyboardScrollToEnd({ listRef });

  // Turns render as user parts, one work row, then assistant and note parts.
  const lastTurnId = useMemo(() => {
    for (let index = state.transcript.items.length - 1; index >= 0; index -= 1) {
      const item = state.transcript.items[index];
      if (item !== undefined && item.kind === "turn") return item.id;
    }
    return undefined;
  }, [state.transcript.items]);

  const rows: ChatRow[] = state.transcript.items.flatMap<ChatRow>((item) => {
    if (item.kind !== "turn") return [item];
    const work: ConversationTurn["parts"] = item.parts.filter(
      (part) => part.kind === "tool" || part.kind === "thinking",
    );
    const visible = item.parts.filter((part) => part.kind !== "tool" && part.kind !== "thinking");
    const emitted: ChatRow[] = [];
    let userSeen = false;
    for (const part of visible) {
      if (part.kind === "user") {
        emitted.push(part);
        userSeen = true;
      }
    }
    if (userSeen || work.length > 0 || item.failure !== undefined || item.durationMs > 0) {
      emitted.push({
        kind: "work",
        turn: item,
        parts: work,
        live: running && item.id === lastTurnId,
      });
    }
    for (const part of visible) {
      if (part.kind !== "user") emitted.push(part);
    }
    return emitted;
  });
  if (streamingText !== "") rows.push({ kind: "stream", text: streamingText });
  rows.push(...state.pending);
  const nextMessageIndex = rows.length;
  const send = useCallback(
    async (content: Parameters<typeof onSend>[0]) => {
      const accepted = await onSend(content);
      if (accepted) {
        pendingAnchorScroll.current = true;
        setAnchorIndex(nextMessageIndex);
        setFollowing(true);
      }
      return accepted;
    },
    [onSend, nextMessageIndex],
  );

  const openFile = useCallback(
    (path: string) => {
      router.push(`/changes/${state.info.sessionId}?path=${encodeURIComponent(path)}`);
    },
    [state.info.sessionId],
  );

  return (
    <html.div style={styles.screen}>
      <View
        style={{ flexGrow: 1, flexBasis: 0, minHeight: 0 }}
        onLayout={(event) => setViewportWidth(event.nativeEvent.layout.width)}
      >
        <KeyboardAwareLegendList
          ref={listRef}
          data={rows}
          extraData={layout}
          renderItem={({ item }) => (
            <MessageRow item={item} layout={layout} onOpenFile={openFile} />
          )}
          keyExtractor={(item) =>
            "change" in item
              ? item.change
              : item.kind === "stream"
                ? "stream"
                : item.kind === "work"
                  ? `work-${item.turn.id}`
                  : item.kind === "tool"
                    ? item.callId
                    : "contentIndex" in item
                      ? `${item.commit}:${item.contentIndex}`
                      : item.commit
          }
          anchoredEndSpace={
            anchorIndex === undefined
              ? undefined
              : {
                  anchorIndex,
                  anchorOffset: spacing.lg,
                  onReady: () => {
                    if (!pendingAnchorScroll.current) return;
                    pendingAnchorScroll.current = false;
                    void scrollMessageToEnd({ animated: false, closeKeyboard: false });
                  },
                }
          }
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingTop: headerHeight + spacing.md,
            paddingBottom: spacing.md,
          }}
          estimatedItemSize={140}
          initialScrollAtEnd
          keyboardLiftBehavior="whenAtEnd"
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          contentInsetEndAdjustment={contentInsetEndAdjustment}
          freeze={freeze}
          maintainScrollAtEnd={following ? { on: { dataChange: true, itemLayout: true } } : false}
          onScrollBeginDrag={() => setFollowing(false)}
          onEndVisible={(visible) => {
            setAtEnd(visible);
            if (visible) setFollowing(true);
          }}
          ListEmptyComponent={
            <html.div style={styles.gutters(layout.paddingLeft, layout.paddingRight)}>
              <html.div style={styles.empty}>
                <EmptyState title="Start a chat" description="Send a message to your Mac." />
              </html.div>
            </html.div>
          }
          ListFooterComponent={
            <html.div style={styles.gutters(layout.paddingLeft, layout.paddingRight)}>
              {waiting ? <WaitingSelection waiting={waiting} onReply={onReply} /> : null}
            </html.div>
          }
        />
      </View>
      <KeyboardStickyView style={{ position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 1 }}>
        {!atEnd ? (
          <html.div style={styles.jumpRow}>
            <GlassButton
              label={answerable ? "Answer question" : "Latest"}
              systemImage="arrow.down"
              iconOnly={!answerable}
              prominent={answerable}
              onPress={() => {
                setFollowing(true);
                void scrollMessageToEnd({ animated: false, closeKeyboard: false });
              }}
            />
          </html.div>
        ) : null}
        {/* One opaque bar over the transcript: the review chips share the
            composer's fill rather than letting rows scroll behind them. */}
        <View
          ref={composerRef}
          onLayout={onComposerLayout}
          style={{ backgroundColor: theme.canvas }}
        >
          {changes !== undefined ? (
            <html.div style={styles.gutters(layout.paddingLeft, layout.paddingRight)}>
              <ReviewStrip changes={changes} onReview={onOpenReview} onAskMerge={onAskMerge} />
            </html.div>
          ) : null}
          <Composer
            target={{
              kind: "session",
              sessionId: state.info.sessionId,
              head: state.head,
              heads: state.info.heads.map((entry) => entry.head),
              config: state.config,
              sending,
              running,
              stopping,
              error,
              onSend: send,
              onStop,
            }}
            placeholder="Follow up…"
            prefill={prefill}
            backdrop="canvas"
            gutters={{ left: layout.paddingLeft, right: layout.paddingRight }}
          />
        </View>
      </KeyboardStickyView>
    </html.div>
  );
}

const styles = css.create({
  // The route's view is native, so the screen fills by size rather than by
  // growing as a flex child of it.
  screen: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    backgroundColor: tokens.canvas,
  },
  gutters: (left: number, right: number) => ({ paddingLeft: left, paddingRight: right }),
  empty: { paddingInline: spacing.sm },
  jumpRow: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "center",
    paddingBottom: spacing.sm,
  },
});
