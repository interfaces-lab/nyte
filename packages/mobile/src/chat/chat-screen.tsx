import { useMemo, useState } from "react";
import { View, useWindowDimensions } from "react-native";
import { css, html } from "react-strict-dom";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { KeyboardStickyView } from "react-native-keyboard-controller";
import { isTerminalPhase } from "@nyte-ai/protocol";
import type { Delivery, ReplyOutcome, SelectionReply, SessionId } from "@nyte-ai/protocol";
import { waitingCall, type SessionState } from "@nyte-ai/client";
import type { FileChange } from "@nyte-ai/client";
import type { UserContent } from "./remote-chat.ts";
import { spacing, tokens, useTheme } from "../theme.ts";
import { Composer } from "./composer.tsx";
import { ReviewStrip } from "./review-strip.tsx";
import { conversationLayout } from "./conversation-layout.ts";
import {
  MessageScrollerButton,
  MessageScrollerProvider,
  useMessageScrollerProvider,
} from "./message-scroller.tsx";
import { Timeline } from "./timeline.tsx";

type ChatScreenProps = {
  state: SessionState;
  streamingText: string;
  sending: boolean;
  error: string | undefined;
  onSend: (content: UserContent, delivery?: Delivery) => Promise<boolean>;
  onStop: () => void;
  onReply: (reply: SelectionReply) => Promise<ReplyOutcome | undefined>;
  delegateNames: ReadonlyMap<SessionId, string>;
  changes: readonly FileChange[] | undefined;
  onAskMerge: () => void;
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
  delegateNames,
  changes,
  onAskMerge,
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

  const scroller = useMessageScrollerProvider({
    autoScroll: true,
    scrollPreviousItemPeek: spacing.lg,
  });
  const running = state.run !== undefined && !isTerminalPhase(state.run.phase);
  const stopping = state.run?.abortRequested === true;
  const waiting = waitingCall(state);
  const { composerRef, onComposerLayout, anchorSend } = scroller;
  // The jump pill doubles as the way back to an off-screen question.
  const answerable = waiting !== undefined;

  return (
    <html.div style={styles.screen}>
      <MessageScrollerProvider value={scroller}>
        <View
          style={{ flexGrow: 1, flexBasis: 0, minHeight: 0 }}
          onLayout={(event) => setViewportWidth(event.nativeEvent.layout.width)}
        >
          <Timeline
            state={state}
            streamingText={streamingText}
            delegateNames={delegateNames}
            onReply={onReply}
            layout={layout}
            headerHeight={headerHeight}
          />
        </View>
        <KeyboardStickyView
          style={{ position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 1 }}
        >
          <MessageScrollerButton
            label={answerable ? "Answer question" : "Latest"}
            prominent={answerable}
          />
          {/* One opaque bar over the transcript: the review chips share the
            composer's fill rather than letting rows scroll behind them. */}
          <View
            ref={composerRef}
            onLayout={onComposerLayout}
            style={{ backgroundColor: theme.canvas }}
          >
            {changes !== undefined ? (
              <html.div style={styles.gutters(layout.paddingLeft, layout.paddingRight)}>
                <ReviewStrip
                  changes={changes}
                  sessionId={state.info.sessionId}
                  onAskMerge={onAskMerge}
                />
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
                onSend: (content, delivery) => anchorSend(onSend(content, delivery)),
                onStop,
              }}
              placeholder="Follow up…"
              prefill={prefill}
              backdrop="canvas"
              gutters={{ left: layout.paddingLeft, right: layout.paddingRight }}
            />
          </View>
        </KeyboardStickyView>
      </MessageScrollerProvider>
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
});
