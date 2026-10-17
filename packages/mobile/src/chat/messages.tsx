import { memo, useState } from "react";
import type { ReactNode } from "react";
import { ActionSheetIOS, ActivityIndicator, Pressable, View } from "react-native";
import { setStringAsync } from "expo-clipboard";
import { SymbolView } from "expo-symbols";
import { css, html } from "react-strict-dom";
import { useQuery } from "@tanstack/react-query";
import type { BlobId, Connection, PartId, SessionId } from "@nyte-ai/sdk";
import { failureNotice } from "@nyte-ai/plugin/client/presentation";
import { useHost } from "../connection/host-context.tsx";
import { controls, media, radii, spacing, textStyles, tokens, useTheme } from "../theme.ts";
import type { ConversationLayout } from "./conversation-layout.ts";
import type { ChatRow } from "./transcript-rows.ts";
import { ActivityIcon, activitySummary } from "./tool-activity-sheet.tsx";
import { CanvasFrame } from "./canvas-frame.tsx";
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

async function blobUri(client: Connection, blob: BlobId, mime: string): Promise<string> {
  const reader = await client.blob(blob);
  let binary = "";

  try {
    for await (const chunk of reader.chunks())
      for (const byte of chunk) binary += String.fromCharCode(byte);
  } finally {
    await reader.close();
  }

  return `data:${mime};base64,${btoa(binary)}`;
}

function BlobImage({ blob, mime, width }: { blob: BlobId; mime: string; width: number }) {
  const { client } = useHost();

  const image = useQuery({
    queryKey: ["blob", blob],
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: () => blobUri(client, blob, mime),
  });

  return (
    <html.img
      alt="Message attachment"
      src={image.data}
      style={[styles.image, styles.imageWidth(width)]}
    />
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

  const text =
    typeof content === "string"
      ? content
      : content.flatMap((part) => (part.kind === "text" ? [part.text] : [])).join("\n");

  const hasPhotos = typeof content !== "string" && content.some((part) => part.kind === "file");
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
            {typeof content !== "string" ? (
              content.map((part, index) =>
                part.kind === "text" ? (
                  <html.p key={index} style={[textStyles.body, styles.outgoingText]}>
                    {part.text}
                  </html.p>
                ) : part.kind === "file" ? (
                  <BlobImage
                    key={index}
                    blob={part.blob}
                    mime={part.mime}
                    width={Math.min(media.thumbnailWidth, maxWidth - 28)}
                  />
                ) : (
                  <html.p key={index} style={[textStyles.body, styles.outgoingText]}>
                    {part.kind === "skill"
                      ? `/${part.name}`
                      : part.kind === "excerpt"
                        ? part.text
                        : `@${part.path}`}
                  </html.p>
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

function CanvasRow({
  item,
  layout,
  onReport,
}: {
  item: Extract<ChatRow, { kind: "canvas" }>;
  layout: ConversationLayout;
  onReport: (part: PartId, message: string) => void;
}) {
  return (
    <Row layout={layout}>
      <Message>
        <View style={{ width: layout.contentWidth }}>
          <CanvasFrame item={item} onReport={(message) => onReport(item.part, message)} />
        </View>
      </Message>
    </Row>
  );
}

function RunStatus({
  execution,
}: {
  execution: Extract<ChatRow, { kind: "status" }>["execution"];
}) {
  const theme = useTheme();
  const waiting = execution.kind === "waiting";

  const label =
    execution.kind === "live"
      ? execution.stopping
        ? "Stopping…"
        : execution.phase === "responding"
          ? "Replying…"
          : "Using tools…"
      : execution.kind === "waiting"
        ? execution.on.kind === "part"
          ? "Waiting for your answer"
          : "Waiting for background work"
        : `${execution.reason}. Retrying…`;

  return (
    <html.div style={styles.status} aria-live="polite">
      {waiting ? null : <ActivityIndicator size="small" color={theme.muted} />}
      <html.span style={textStyles.caption}>{label}</html.span>
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
  onReport,
}: {
  item: ChatRow;
  layout: ConversationLayout;
  delegateNames: ReadonlyMap<SessionId, string>;
  onOpenActivity: (item: Extract<ChatRow, { kind: "activity" }>) => void;
  onReport: (part: PartId, message: string) => void;
}) {
  if (item.kind === "user") return <UserMessage item={item} layout={layout} />;

  if (item.kind === "assistant") return <AssistantMessage item={item} layout={layout} />;

  if (item.kind === "canvas") return <CanvasRow item={item} layout={layout} onReport={onReport} />;

  return (
    <Row layout={layout}>
      {item.kind === "activity" ? (
        <WorkRow item={item} delegateNames={delegateNames} onOpenActivity={onOpenActivity} />
      ) : item.kind === "status" ? (
        <RunStatus execution={item.execution} />
      ) : item.kind === "summary" ? (
        <Summary text={item.text} />
      ) : item.kind === "marker" ? (
        <Marker>{item.text}</Marker>
      ) : (
        <html.div role="status" style={styles.status}>
          <html.span
            style={[textStyles.secondary, item.failure.class !== "aborted" && styles.failed]}
          >
            {failureNotice(item.failure).text}
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
