import { memo, useState } from "react";
import type { ReactNode } from "react";
import { ActionSheetIOS, ActivityIndicator, Pressable, View } from "react-native";
import { setStringAsync } from "expo-clipboard";
import { SymbolView } from "expo-symbols";
import { css, html } from "react-strict-dom";
import { isTerminalPhase } from "@nyte-ai/protocol";
import type { Failure, RunInfo, SessionId } from "@nyte-ai/protocol";
import { controls, media, radii, spacing, textStyles, tokens, useTheme } from "../theme.ts";
import type { ConversationLayout } from "./conversation-layout.ts";
import type { ChatRow } from "./transcript-rows.ts";
import { ActivityIcon, activitySummary } from "./tool-activity-sheet.tsx";
import { Markdown } from "./markdown.tsx";
import { Bubble } from "./bubble.tsx";
import { Marker } from "./marker.tsx";
import { Message, MessageFooter } from "./message.tsx";

function Row({ layout, children }: { layout: ConversationLayout; children: ReactNode }) {
  return (
    <html.div style={styles.gutters(layout.paddingLeft, layout.paddingRight)}>{children}</html.div>
  );
}

function copySheet(text: string) {
  if (text === "") return;
  ActionSheetIOS.showActionSheetWithOptions(
    { options: ["Cancel", "Copy Message"], cancelButtonIndex: 0 },
    (index) => {
      if (index === 1) void setStringAsync(text);
    },
  );
}

function UserMessage({
  item,
  layout,
}: {
  item: Extract<ChatRow, { kind: "user" }>;
  layout: ConversationLayout;
}) {
  const content = item.content;

  const text = Array.isArray(content)
    ? content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
    : content;

  const hasPhotos = Array.isArray(content) && content.some((part) => part.type !== "text");
  const maxWidth = Math.floor(layout.contentWidth * media.bubbleMaxWidthRatio);

  return (
    <Row layout={layout}>
      <Message align="end">
        <Pressable
          accessible
          accessibilityRole="text"
          accessibilityLabel={[
            text,
            hasPhotos ? "Attached photos" : "",
            item.delivery === "queued" ? "Queued" : "",
          ]
            .filter(Boolean)
            .join(". ")}
          accessibilityActions={text === "" ? [] : [{ name: "copy", label: "Copy Message" }]}
          onAccessibilityAction={({ nativeEvent }) => {
            if (nativeEvent.actionName === "copy") void setStringAsync(text);
          }}
          onLongPress={() => copySheet(text)}
          style={{ maxWidth }}
        >
          <Bubble variant="outgoing">
            {Array.isArray(content) ? (
              content.map((part, index) =>
                part.type === "text" ? (
                  <html.p key={index} style={[textStyles.body, styles.outgoingText]}>
                    {part.text}
                  </html.p>
                ) : (
                  <html.img
                    key={index}
                    alt="Message attachment"
                    src={`data:${part.mimeType};base64,${part.data}`}
                    style={[
                      styles.image,
                      styles.imageWidth(Math.min(media.thumbnailWidth, maxWidth - 28)),
                    ]}
                  />
                ),
              )
            ) : (
              <html.p style={[textStyles.body, styles.outgoingText]}>{content}</html.p>
            )}
          </Bubble>
        </Pressable>
        {item.delivery === "queued" ? <MessageFooter>Queued</MessageFooter> : null}
      </Message>
    </Row>
  );
}

function AssistantMessage({
  item,
  layout,
}: {
  item: Extract<ChatRow, { kind: "assistant" }>;
  layout: ConversationLayout;
}) {
  return (
    <Row layout={layout}>
      <Message>
        <View style={{ width: Math.floor(layout.contentWidth * 0.94) }}>
          <Bubble variant="incoming">
            <Markdown text={item.text} streaming={item.streaming} copyMessage />
          </Bubble>
        </View>
      </Message>
    </Row>
  );
}

function failureLabel(failure: Failure): string {
  switch (failure.class) {
    case "aborted":
      return "Stopped";
    case "rate_limit":
      return "Rate limited";
    case "context_window":
      return "Context window exceeded";
    case "quota":
      return "Quota reached";
    case "auth":
      return "Authentication failed";
    case "overloaded":
      return "Model unavailable";
    case "network":
      return "Connection lost";
    case "provider":
    case "runner":
      return failure.message.replaceAll(/\s+/gu, " ").trim() || "Response failed";
    default: {
      const exhaustive: never = failure.class;

      return exhaustive;
    }
  }
}

function RunStatus({ run }: { run: RunInfo }) {
  const theme = useTheme();
  const phase = run.phase;
  const active = !isTerminalPhase(phase);
  let label: string;

  if (run.abortRequested && active) label = "Stopping…";
  else {
    switch (phase.kind) {
      case "respond":
        label = "Replying…";
        break;
      case "tools":
        label = "Using tools…";
        break;
      case "waiting":
        label = run.awaitingReply ? "Waiting for your answer" : "Waiting for background work";
        break;
      case "retry":
        label = `${failureLabel(phase.failure)}. Retrying…`;
        break;
      case "aborted":
        label = "Stopped";
        break;
      case "failed":
        label = failureLabel(phase.failure);
        break;
      case "done":
        return null;
      default: {
        const exhaustive: never = phase;

        return exhaustive;
      }
    }
  }

  return (
    <html.div style={styles.status} aria-live="polite">
      {active && phase.kind !== "waiting" ? (
        <ActivityIndicator size="small" color={theme.muted} />
      ) : null}
      <html.span style={[textStyles.caption, phase.kind === "failed" && styles.failed]}>
        {label}
      </html.span>
    </html.div>
  );
}

function WorkRow({
  item,
  delegateNames,
  onOpenActivity,
}: {
  item: Extract<ChatRow, { kind: "activity" }>;
  delegateNames: ReadonlyMap<SessionId, string>;
  onOpenActivity: (item: Extract<ChatRow, { kind: "activity" }>) => void;
}) {
  const theme = useTheme();
  const summary = activitySummary(item.parts, delegateNames);

  return (
    <html.button
      aria-label={`${summary.title}. Show activity`}
      aria-haspopup="dialog"
      onClick={() => onOpenActivity(item)}
      style={styles.activity}
    >
      <ActivityIcon tone={summary.tone} />
      <html.span
        style={[
          textStyles.secondary,
          styles.activityTitle,
          summary.tone === "failure" && styles.failed,
        ]}
      >
        {summary.title}
      </html.span>
      <SymbolView name="chevron.right" size={11} weight="semibold" tintColor={theme.muted} />
    </html.button>
  );
}

function Summary({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <html.div style={styles.summary}>
      <html.button
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        style={styles.activity}
      >
        <html.span style={textStyles.secondary}>
          {expanded ? "Hide conversation summary" : "Conversation summary"}
        </html.span>
      </html.button>
      {expanded ? <Markdown text={text} /> : null}
    </html.div>
  );
}

export const MessageRow = memo(function MessageRow({
  item,
  layout,
  delegateNames,
  onOpenActivity,
}: {
  item: ChatRow;
  layout: ConversationLayout;
  delegateNames: ReadonlyMap<SessionId, string>;
  onOpenActivity: (item: Extract<ChatRow, { kind: "activity" }>) => void;
}) {
  if (item.kind === "user") return <UserMessage item={item} layout={layout} />;

  if (item.kind === "assistant") return <AssistantMessage item={item} layout={layout} />;

  return (
    <Row layout={layout}>
      {item.kind === "activity" ? (
        <WorkRow item={item} delegateNames={delegateNames} onOpenActivity={onOpenActivity} />
      ) : item.kind === "status" ? (
        <RunStatus run={item.run} />
      ) : item.kind === "summary" ? (
        <Summary text={item.text} />
      ) : item.kind === "marker" ? (
        <Marker>{item.text}</Marker>
      ) : (
        <html.div role="status" style={styles.status}>
          <html.span
            style={[textStyles.secondary, item.failure.class !== "aborted" && styles.failed]}
          >
            {failureLabel(item.failure)}
          </html.span>
        </html.div>
      )}
    </Row>
  );
});

const styles = css.create({
  gutters: (left: number, right: number) => ({ paddingLeft: left, paddingRight: right }),
  outgoingText: { color: tokens.outgoingText },
  image: { height: media.thumbnailHeight, borderRadius: radii.control, objectFit: "cover" },
  imageWidth: (width: number) => ({ width }),
  activity: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: controls.touchTarget,
    borderWidth: 0,
    paddingInline: spacing.sm,
    opacity: { default: 1, ":active": controls.disabledOpacity },
  },
  activityTitle: { flexShrink: 1, lineClamp: 1, textAlign: "start" },
  failed: { color: tokens.danger },
  status: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
  },
  summary: { paddingBlock: spacing.xs },
});
