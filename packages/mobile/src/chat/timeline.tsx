import { router } from "expo-router";
import { css, html } from "react-strict-dom";
import type { ActOutcome, PartId, SessionId, SessionView } from "@nyte-ai/sdk";
import type { QuestionAnswers } from "@nyte-ai/plugin/question/schema";
import { spacing } from "../theme.ts";
import type { AskedQuestion } from "../view-helpers.ts";
import { EmptyState } from "../ui/empty-state.tsx";
import type { ConversationLayout } from "./conversation-layout.ts";
import { MessageRow, type QueuedActions } from "./messages.tsx";
import { MessageScroller } from "./message-scroller.tsx";
import { conversationRows } from "./transcript-rows.ts";
import { WaitingSelection } from "./waiting-selection.tsx";
import { ToolActivitySheet, useActivitySheet } from "./tool-activity-sheet.tsx";

type TimelineProps = {
  state: SessionView;
  sessionId: SessionId;
  delegateNames: ReadonlyMap<SessionId, string>;
  question: AskedQuestion | undefined;
  queued: QueuedActions;
  onAnswer: (
    asked: AskedQuestion,
    answers: QuestionAnswers,
  ) => Promise<ActOutcome<unknown> | undefined>;
  onReport: (part: PartId, message: string) => void;
  layout: ConversationLayout;
  headerHeight: number;
};

export function Timeline({
  state,
  sessionId,
  delegateNames,
  question,
  queued,
  onAnswer,
  onReport,
  layout,
  headerHeight,
}: TimelineProps) {
  const transcript = conversationRows(state);
  const activity = useActivitySheet(transcript);

  const rows = transcript.map((row) => ({
    messageId: row.id,
    scrollAnchor: row.kind === "user",
    row,
  }));

  const openFile = (path: string) => {
    router.push(`/changes/${sessionId}?path=${encodeURIComponent(path)}`);
  };

  const openCanvas = (part: PartId) => {
    router.push(`/canvas/${sessionId}?part=${encodeURIComponent(part)}`);
  };

  return (
    <>
      <MessageScroller
        data={rows}
        getItemType={(item) => item.row.kind}
        extraData={layout}
        renderItem={({ item }) => (
          <MessageRow
            item={item.row}
            layout={layout}
            delegateNames={delegateNames}
            queued={queued}
            onOpenActivity={activity.openActivity}
            onReport={onReport}
            onOpenCanvas={openCanvas}
          />
        )}
        contentContainerStyle={{ paddingTop: headerHeight + spacing.md, paddingBottom: spacing.md }}
        ListEmptyComponent={
          <html.div style={styles.gutters(layout.paddingLeft, layout.paddingRight)}>
            <EmptyState title="Start a chat" description="Send a message to your Mac." />
          </html.div>
        }
        ListFooterComponent={
          <html.div style={styles.gutters(layout.paddingLeft, layout.paddingRight)}>
            {question === undefined ? null : (
              <WaitingSelection
                question={question.question}
                origin={question.origin}
                onReply={(answers) => onAnswer(question, answers)}
              />
            )}
          </html.div>
        }
      />
      <ToolActivitySheet
        open={activity.open}
        parts={activity.parts}
        delegateNames={delegateNames}
        onClose={activity.close}
        onOpenFile={openFile}
        onOpenSession={(child) => router.push(`/chat/${child}`)}
      />
    </>
  );
}

const styles = css.create({
  gutters: (left: number, right: number) => ({ paddingLeft: left, paddingRight: right }),
});
