import { useCallback, useMemo, useRef, useState } from "react";
import type { ComponentProps } from "react";
import { View, useWindowDimensions } from "react-native";
import { css, html } from "react-strict-dom";
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
import { waitingCall, type SessionState } from "@nyte-ai/core/client";
import { conversation, spacing, textStyles, tokens } from "../theme.ts";
import { EmptyState } from "../ui/empty-state.tsx";
import type { UserContent } from "./remote-chat.ts";
import { ModelSelector } from "./model-selector.tsx";
import { GlassButton } from "../ui/glass-button.tsx";
import { WaitingSelection } from "./waiting-selection.tsx";
import { Composer } from "./composer.tsx";
import { MessageRow, type ChatRow } from "./messages.tsx";
import { conversationLayout } from "./conversation-layout.ts";
type ChatScreenProps = {
  state: SessionState;
  streamingText: string;
  error: string | undefined;
  onReply: (reply: SelectionReply) => Promise<ReplyOutcome | undefined>;
  onReview: () => void;
  onBack: () => void;
} & ComponentProps<typeof ModelSelector> &
  Pick<ComponentProps<typeof Composer>, "sending" | "onSend" | "onStop">;

const phaseLabels = {
  respond: "Responding",
  tools: "Using tools",
  waiting: "Waiting on Mac",
  retry: "Retrying",
  done: "Ready",
  aborted: "Stopped",
  failed: "Failed",
};

export function ChatScreen({
  state,
  streamingText,
  sending,
  error,
  onSend,
  onStop,
  onBack,
  onReply,
  onReview,
  client,
  selectedModel,
  selectingModel,
  modelError,
  onSelect,
}: ChatScreenProps) {
  const insets = useSafeAreaInsets();
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
  const status = waiting
    ? "Needs your answer"
    : running && stopping
      ? "Stopping"
      : state.run
        ? phaseLabels[state.run.phase.kind]
        : "Ready";
  const { contentInsetEndAdjustment, onComposerLayout } = useKeyboardChatComposerInset(
    listRef,
    composerRef,
  );
  const { freeze, scrollMessageToEnd } = useKeyboardScrollToEnd({ listRef });
  const rows: ChatRow[] = state.transcript.items.flatMap<ChatRow>((turn) =>
    turn.kind === "turn" ? turn.parts : [turn],
  );
  if (streamingText !== "") rows.push({ kind: "stream", text: streamingText });
  rows.push(...state.pending);
  const nextMessageIndex = rows.length;
  const send = useCallback(
    async (content: UserContent) => {
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

  return (
    <html.div data-layoutconformance="strict" style={styles.screen}>
      <html.div
        style={[
          styles.header,
          styles.headerInsets(insets.top, insets.left + spacing.md, insets.right + spacing.md),
        ]}
      >
        <GlassButton label="Back to chats" systemImage="chevron.left" iconOnly onPress={onBack} />
        <html.div style={styles.heading}>
          <html.h1 style={[textStyles.title, styles.title]}>
            {state.info.name || "Untitled conversation"}
          </html.h1>
          <html.p style={textStyles.caption} aria-live="polite">
            {status}
          </html.p>
        </html.div>
        <GlassButton
          label="Review changed files"
          systemImage="doc.text.magnifyingglass"
          iconOnly
          onPress={onReview}
        />
      </html.div>
      <View
        style={{ flexGrow: 1, flexBasis: 0, minHeight: 0 }}
        onLayout={(event) => setViewportWidth(event.nativeEvent.layout.width)}
      >
        <KeyboardAwareLegendList
          ref={listRef}
          data={rows}
          extraData={layout}
          renderItem={({ item }) => <MessageRow item={item} layout={layout} />}
          keyExtractor={(item) =>
            "change" in item
              ? item.change
              : item.kind === "stream"
                ? "stream"
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
          contentContainerStyle={{ paddingTop: spacing.lg, paddingBottom: spacing.md }}
          estimatedItemSize={140}
          initialScrollAtEnd
          keyboardLiftBehavior="whenAtEnd"
          keyboardOffset={insets.bottom}
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
              {!error && running && !streamingText && !waiting ? (
                <html.p style={[textStyles.caption, styles.notice]}>{status}…</html.p>
              ) : null}
            </html.div>
          }
        />
      </View>
      <KeyboardStickyView
        offset={{ opened: insets.bottom }}
        style={{ position: "absolute", left: 0, right: 0, bottom: 0 }}
      >
        {!atEnd ? (
          <html.div style={styles.jumpRow}>
            <GlassButton
              label="Latest"
              systemImage="arrow.down"
              onPress={() => {
                setFollowing(true);
                void scrollMessageToEnd({ animated: false, closeKeyboard: false });
              }}
            />
          </html.div>
        ) : null}
        <Composer
          layout={layout}
          sending={sending}
          error={error}
          selectingModel={selectingModel}
          running={running}
          stopping={stopping}
          onSend={send}
          onStop={onStop}
          composerRef={composerRef}
          onLayout={onComposerLayout}
        >
          <ModelSelector
            client={client}
            selectedModel={selectedModel}
            selectingModel={selectingModel}
            modelError={modelError}
            onSelect={onSelect}
          />
        </Composer>
      </KeyboardStickyView>
    </html.div>
  );
}

const styles = css.create({
  screen: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    backgroundColor: tokens.background,
  },
  header: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: spacing.md,
  },
  headerInsets: (top: number, left: number, right: number) => ({
    paddingTop: top + spacing.sm,
    paddingLeft: left,
    paddingRight: right,
  }),
  heading: { flexGrow: 1, flexShrink: 1, gap: spacing.xs, paddingInline: spacing.sm },
  title: { overflow: "hidden", lineClamp: 1 },
  gutters: (left: number, right: number) => ({ paddingLeft: left, paddingRight: right }),
  notice: { paddingInline: conversation.textInset, paddingBlock: spacing.md },
  empty: { paddingInline: conversation.textInset },
  jumpRow: { display: "flex", alignItems: "center", paddingBottom: spacing.sm },
});
