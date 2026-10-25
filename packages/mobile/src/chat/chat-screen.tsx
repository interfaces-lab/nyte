import { useMemo, useState } from "react";
import { View, useWindowDimensions } from "react-native";
import { css, html } from "react-strict-dom";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { KeyboardStickyView } from "react-native-keyboard-controller";
import type { QuestionAnswers } from "@nyte-ai/plugin/question/schema";
import type {
  ActOutcome,
  Configuration,
  Delivery,
  HeadName,
  PartId,
  SessionId,
  SessionView,
  WorkspaceId,
} from "@nyte-ai/sdk";
import type { DraftContent } from "../media/attachments.ts";
import { spacing, tokens } from "../theme.ts";
import type { AskedQuestion } from "../view-helpers.ts";
import { Composer } from "./composer.tsx";
import type { QueuedActions } from "./messages.tsx";
import type { SendOutcome } from "./remote-chat.ts";
import { SubagentBar } from "./subagent-bar.tsx";
import { ReviewStrip } from "./review-strip.tsx";
import { conversationLayout } from "./conversation-layout.ts";
import {
  MessageScrollerButton,
  MessageScrollerProvider,
  useMessageScrollerProvider,
} from "./message-scroller.tsx";
import { Timeline } from "./timeline.tsx";

type ChatScreenProps = {
  state: SessionView;
  sessionId: SessionId;
  workspace: WorkspaceId | undefined;
  head: string;
  configuration: Configuration | null;
  sending: boolean;
  error: string | undefined;
  onSend: (content: DraftContent, delivery?: Delivery) => Promise<SendOutcome>;
  onStop: () => void;
  question: AskedQuestion | undefined;
  onAnswer: (
    asked: AskedQuestion,
    answers: QuestionAnswers,
  ) => Promise<ActOutcome<unknown> | undefined>;
  queued: QueuedActions;
  onReport: (part: PartId, message: string) => void;
  onChooseHead: (head: HeadName) => void;
  delegateNames: ReadonlyMap<SessionId, string>;
  changes: SessionView["changes"] | undefined;
  onAskMerge: () => void;
  /** Set for a subagent's conversation, which takes no messages of its own. */
  subagent: { parentName: string; onOpenParent: () => void } | undefined;
};

/**
 * A session's transcript under a floating glass header, with the composer docked above the keyboard.
 * The list spans the window while rows and the composer share one measured column, and the jump pill
 * doubles as the way back to an off-screen question.
 */
export function ChatScreen({
  state,
  sessionId,
  workspace,
  head,
  configuration,
  sending,
  error,
  onSend,
  onStop,
  question,
  onAnswer,
  queued,
  onReport,
  onChooseHead,
  delegateNames,
  changes,
  onAskMerge,
  subagent,
}: ChatScreenProps) {
  const insets = useSafeAreaInsets();
  const headerHeight = insets.top + 44;
  const window = useWindowDimensions();
  const [viewportWidth, setViewportWidth] = useState(window.width);

  const layout = useMemo(
    () => conversationLayout(viewportWidth, { left: insets.left, right: insets.right }),
    [viewportWidth, insets.left, insets.right],
  );

  const scroller = useMessageScrollerProvider({
    autoScroll: true,
    scrollPreviousItemPeek: spacing.lg,
  });

  const running = state.execution.kind !== "idle";
  const stopping = state.execution.kind === "live" && state.execution.stopping;
  const { composerRef, onComposerLayout, anchorSend } = scroller;
  const answerable = question !== undefined;
  const gutters = { left: layout.paddingLeft, right: layout.paddingRight };

  return (
    <html.div style={styles.screen}>
      <MessageScrollerProvider value={scroller}>
        <View
          style={{ flexGrow: 1, flexBasis: 0, minHeight: 0 }}
          onLayout={(event) => setViewportWidth(event.nativeEvent.layout.width)}
        >
          <Timeline
            state={state}
            sessionId={sessionId}
            delegateNames={delegateNames}
            question={question}
            queued={queued}
            onAnswer={onAnswer}
            onReport={onReport}
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
          <View ref={composerRef} onLayout={onComposerLayout}>
            {changes !== undefined ? (
              <html.div style={styles.gutters(layout.paddingLeft, layout.paddingRight)}>
                <ReviewStrip changes={changes} sessionId={sessionId} onAskMerge={onAskMerge} />
              </html.div>
            ) : null}
            {subagent !== undefined ? (
              <SubagentBar
                parentName={subagent.parentName}
                running={running}
                stopping={stopping}
                gutters={gutters}
                onOpenParent={subagent.onOpenParent}
                onStop={onStop}
              />
            ) : (
              <Composer
                target={{
                  kind: "session",
                  sessionId,
                  head,
                  heads: state.heads.map((entry) => entry.name),
                  config: configuration,
                  workspace,
                  catalog: state.catalog,
                  sending,
                  running,
                  stopping,
                  error,
                  onSend: (content, delivery) => anchorSend(onSend(content, delivery)),
                  onStop,
                  onChooseHead,
                }}
                placeholder="Follow up…"
                gutters={gutters}
              />
            )}
          </View>
        </KeyboardStickyView>
      </MessageScrollerProvider>
    </html.div>
  );
}

const styles = css.create({
  /** The route's view is native, so the screen fills by size rather than growing as a flex child. */
  screen: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    backgroundColor: tokens.canvas,
  },
  gutters: (left: number, right: number) => ({ paddingLeft: left, paddingRight: right }),
});
