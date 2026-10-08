import { useCallback, useMemo } from "react";
import { router } from "expo-router";
import { css, html } from "react-strict-dom";
import type { ReplyOutcome, SelectionReply, SessionId } from "@nyte-ai/protocol";
import { waitingCall } from "@nyte-ai/client";
import type { SessionState } from "@nyte-ai/client";
import { spacing } from "../theme.ts";
import { EmptyState } from "../ui/empty-state.tsx";
import type { ConversationLayout } from "./conversation-layout.ts";
import { MessageRow } from "./messages.tsx";
import { MessageScroller } from "./message-scroller.tsx";
import { conversationRows, transcriptRows } from "./transcript-rows.ts";
import { WaitingSelection } from "./waiting-selection.tsx";
import { ToolActivitySheet, useActivitySheet } from "./tool-activity-sheet.tsx";

type TimelineProps = {
  state: SessionState;
  delegateNames: ReadonlyMap<SessionId, string>;
  onReply: (reply: SelectionReply) => Promise<ReplyOutcome | undefined>;
  layout: ConversationLayout;
  headerHeight: number;
};

export function Timeline({ state, delegateNames, onReply, layout, headerHeight }: TimelineProps) {
  const waiting = waitingCall(state);
  const committed = useMemo(() => transcriptRows(state.transcript.items), [state.transcript.items]);

  const transcript = useMemo(() => conversationRows(committed, state), [committed, state]);
  const activity = useActivitySheet(transcript);

  const rows = useMemo(
    () =>
      transcript.map((row) => ({
        messageId: row.id,
        scrollAnchor: row.kind === "user",
        row,
      })),
    [transcript],
  );

  const openFile = useCallback(
    (path: string) => {
      router.push(`/changes/${state.info.sessionId}?path=${encodeURIComponent(path)}`);
    },
    [state.info.sessionId],
  );

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
            onOpenActivity={activity.openActivity}
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
            {waiting ? <WaitingSelection waiting={waiting} onReply={onReply} /> : null}
          </html.div>
        }
      />
      <ToolActivitySheet
        open={activity.open}
        parts={activity.parts}
        delegateNames={delegateNames}
        onClose={activity.close}
        onOpenFile={openFile}
      />
    </>
  );
}

const styles = css.create({
  gutters: (left: number, right: number) => ({ paddingLeft: left, paddingRight: right }),
});
