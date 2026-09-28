import { useCallback, useMemo } from "react";
import { router } from "expo-router";
import { css, html } from "react-strict-dom";
import { isTerminalPhase } from "@nyte-ai/protocol";
import type { ReplyOutcome, SelectionReply, SessionId } from "@nyte-ai/protocol";
import { waitingCall } from "@nyte-ai/client";
import type { SessionState } from "@nyte-ai/client";
import { spacing } from "../theme.ts";
import { EmptyState } from "../ui/empty-state.tsx";
import type { ConversationLayout } from "./conversation-layout.ts";
import { MessageRow, type ChatRow } from "./messages.tsx";
import { MessageScroller, type MessageScrollerItem } from "./message-scroller.tsx";
import type { ConversationTurn } from "./turn-changes.ts";
import { WaitingSelection } from "./waiting-selection.tsx";

type TimelineProps = {
  state: SessionState;
  streamingText: string;
  delegateNames: ReadonlyMap<SessionId, string>;
  onReply: (reply: SelectionReply) => Promise<ReplyOutcome | undefined>;
  layout: ConversationLayout;
  headerHeight: number;
};

type TimelineItem = MessageScrollerItem & { row: ChatRow };

function timelineItem(row: ChatRow): TimelineItem {
  if ("change" in row) return { messageId: row.change, scrollAnchor: true, row };

  return {
    messageId:
      row.kind === "stream"
        ? "stream"
        : row.kind === "work"
          ? `work-${row.turn.id}`
          : row.kind === "tool"
            ? row.callId
            : "contentIndex" in row
              ? `${row.commit}:${row.contentIndex}`
              : row.commit,
    scrollAnchor: row.kind === "user",
    row,
  };
}

export function Timeline({
  state,
  streamingText,
  delegateNames,
  onReply,
  layout,
  headerHeight,
}: TimelineProps) {
  const running = state.run !== undefined && !isTerminalPhase(state.run.phase);
  const waiting = waitingCall(state);

  const transcriptRows = useMemo(() => {
    const items = state.transcript.items;
    const lastTurnId = items.findLast((item) => item.kind === "turn")?.id;
    const rows: TimelineItem[] = [];

    for (const item of items) {
      if (item.kind !== "turn") {
        rows.push(timelineItem(item));
        continue;
      }

      const work: ConversationTurn["parts"] = [];
      let userSeen = false;

      for (const part of item.parts) {
        if (part.kind === "user") {
          rows.push(timelineItem(part));
          userSeen = true;
        } else if (part.kind === "tool" || part.kind === "thinking") {
          work.push(part);
        }
      }

      if (userSeen || work.length > 0 || item.failure !== undefined || item.durationMs > 0) {
        rows.push(
          timelineItem({
            kind: "work",
            turn: item,
            parts: work,
            live: running && item.id === lastTurnId,
          }),
        );
      }

      for (const part of item.parts) {
        if (part.kind === "assistant") rows.push(timelineItem(part));
      }
    }

    return rows;
  }, [state.transcript.items, running]);

  const rows = useMemo(() => {
    const rows = [...transcriptRows];

    if (streamingText !== "") rows.push(timelineItem({ kind: "stream", text: streamingText }));

    rows.push(...state.pending.map(timelineItem));

    return rows;
  }, [transcriptRows, streamingText, state.pending]);

  const openFile = useCallback(
    (path: string) => {
      router.push(`/changes/${state.info.sessionId}?path=${encodeURIComponent(path)}`);
    },
    [state.info.sessionId],
  );

  return (
    <MessageScroller
      data={rows}
      getItemType={(item) => ("change" in item.row ? "pending" : item.row.kind)}
      extraData={layout}
      renderItem={({ item }) => (
        <MessageRow
          item={item.row}
          layout={layout}
          delegateNames={delegateNames}
          onOpenFile={openFile}
        />
      )}
      contentContainerStyle={{
        paddingTop: headerHeight + spacing.md,
        paddingBottom: spacing.md,
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
  );
}

const styles = css.create({
  gutters: (left: number, right: number) => ({ paddingLeft: left, paddingRight: right }),
  empty: { paddingInline: spacing.sm },
});
