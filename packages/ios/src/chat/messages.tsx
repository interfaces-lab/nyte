import { memo, useState } from "react";
import type { ReactNode } from "react";
import { ActionSheetIOS, ActivityIndicator, Alert, Linking, Pressable } from "react-native";
import { setStringAsync } from "expo-clipboard";
import { SymbolView } from "expo-symbols";
import { css, html } from "react-strict-dom";
import { EnrichedMarkdownText } from "react-native-enriched-markdown";
import type { TurnPart } from "@nyte-ai/protocol";
import type { SessionState } from "@nyte-ai/core/client";
import { diffStat, presentTool, projectToolView, readPatch } from "@nyte-ai/core/views";
import {
  controls,
  conversation,
  list,
  markdownStyle,
  media,
  useTheme,
  radii,
  spacing,
  textStyles,
  tokens,
} from "../theme.ts";
import type { ConversationLayout } from "./conversation-layout.ts";
import { elapsed } from "./sessions.ts";
import { fileStatus, formatDuration, type ConversationTurn } from "./turn-changes.ts";

export type ChatRow =
  | TurnPart
  | Exclude<SessionState["transcript"]["items"][number], { kind: "turn" }>
  | SessionState["pending"][number]
  | { kind: "work"; turn: ConversationTurn; parts: TurnPart[]; live: boolean }
  | { kind: "stream"; text: string };

export function Markdown({
  text,
  width,
  streaming = false,
}: {
  text: string;
  width: number;
  streaming?: boolean;
}) {
  const theme = useTheme();
  return (
    <EnrichedMarkdownText
      markdown={text}
      markdownStyle={markdownStyle(theme)}
      flavor="github"
      streamingAnimation={streaming}
      enableTaskListItemToggle={false}
      // Native Markdown wraps only against an explicit width.
      containerStyle={{ width }}
      onLinkPress={({ url }) => {
        if (!/^https?:\/\//i.test(url)) return;
        void Linking.openURL(url).catch(() => Alert.alert("Couldn't open link", url));
      }}
    />
  );
}

function Row({ layout, children }: { layout: ConversationLayout; children: ReactNode }) {
  return (
    <html.div style={[styles.row, styles.gutters(layout.paddingLeft, layout.paddingRight)]}>
      {children}
    </html.div>
  );
}

/** Long-press copy keeps the transcript free of per-row copy buttons. */
function copySheet(text: string) {
  ActionSheetIOS.showActionSheetWithOptions(
    { options: ["Cancel", "Copy"], cancelButtonIndex: 0 },
    (index) => {
      if (index === 1) void setStringAsync(text);
    },
  );
}

function UserMessage({
  content,
  layout,
  note,
}: Pick<SessionState["pending"][number], "content"> & {
  layout: ConversationLayout;
  note?: string;
}) {
  const text =
    typeof content === "string"
      ? content
      : content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");
  return (
    <Row layout={layout}>
      <Pressable onLongPress={() => copySheet(text)}>
        <html.div style={styles.userRow}>
          <html.div
            style={[
              styles.userBubble,
              styles.bubbleWidth(Math.floor(layout.contentWidth * media.bubbleMaxWidthRatio)),
            ]}
          >
            {typeof content === "string" ? (
              <html.p style={textStyles.body}>{content}</html.p>
            ) : (
              content.map((part, index) =>
                part.type === "text" ? (
                  <html.p key={index} style={textStyles.body}>
                    {part.text}
                  </html.p>
                ) : (
                  <html.img
                    key={index}
                    alt="Message attachment"
                    src={`data:${part.mimeType};base64,${part.data}`}
                    style={styles.image}
                  />
                ),
              )
            )}
          </html.div>
          {note ? <html.span style={textStyles.caption}>{note}</html.span> : null}
        </html.div>
      </Pressable>
    </Row>
  );
}

function AssistantMessage({
  text,
  layout,
  streaming = false,
}: {
  text: string;
  layout: ConversationLayout;
  streaming?: boolean;
}) {
  return (
    <Row layout={layout}>
      <Pressable
        onLongPress={() => {
          if (!streaming) copySheet(text);
        }}
      >
        <html.div style={styles.assistant}>
          <Markdown
            text={text}
            width={layout.contentWidth - conversation.textInset * 2}
            streaming={streaming}
          />
        </html.div>
      </Pressable>
    </Row>
  );
}

function Disclosure({
  title,
  text,
  layout,
}: {
  title: string;
  text: string;
  layout: ConversationLayout;
}) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  return (
    <html.div style={styles.disclosure}>
      <html.button
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        style={styles.disclosureButton}
      >
        <html.span style={[textStyles.secondary, styles.disclosureTitle]}>{title}</html.span>
        <html.div style={styles.chevron(expanded)}>
          <SymbolView name="chevron.right" size={11} weight="semibold" tintColor={theme.tertiary} />
        </html.div>
      </html.button>
      {expanded ? (
        <html.div style={styles.disclosureBody}>
          <Markdown text={text} width={layout.contentWidth - conversation.textInset * 2} />
        </html.div>
      ) : null}
    </html.div>
  );
}

/** A file-edit tool result: status badge, basename, totals, opens the diff. */
function EditRow({
  part,
  onOpenFile,
}: {
  part: Extract<TurnPart, { kind: "tool" }>;
  onOpenFile?: (path: string) => void;
}) {
  const theme = useTheme();
  const patch = part.result === undefined ? undefined : readPatch(part.result.details);
  const stat = patch === undefined ? { added: 0, removed: 0 } : diffStat(patch);
  const presentation = presentTool(projectToolView(part));
  const body = presentation.body;
  const path = body.kind === "diff" ? body.path : undefined;
  const file = body.kind === "diff" && body.files.length === 1 ? body.files[0] : undefined;
  const basename = path?.split("/").pop() ?? presentation.title ?? part.toolName;
  const status = file === undefined ? "M" : fileStatus(file);
  return (
    <html.button
      onClick={() => {
        if (path !== undefined) onOpenFile?.(path);
      }}
      style={styles.editRow}
    >
      <html.div style={styles.editBadge}>
        <html.span style={styles.editBadgeText}>{status}</html.span>
      </html.div>
      <html.span style={[textStyles.secondary, styles.editTitle]}>{basename}</html.span>
      <html.span style={[textStyles.caption, styles.editTotals]}>
        {`+${String(stat.added)} \u2212${String(stat.removed)}`}
      </html.span>
      <SymbolView name="chevron.right" size={13} tintColor={theme.tertiary} />
    </html.button>
  );
}

const workLabels: Record<ConversationTurn["outcome"], string> = {
  completed: "Finished",
  aborted: "Stopped",
  failed: "Failed",
};

function WorkRow({
  turn,
  parts,
  live,
  layout,
  onOpenFile,
}: {
  turn: ConversationTurn;
  parts: TurnPart[];
  live: boolean;
  layout: ConversationLayout;
  onOpenFile?: (path: string) => void;
}) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [now] = useState(() => Date.now());
  const failed = turn.outcome === "failed";
  const label = live ? `Responding · ${elapsed(turn.startedAt, now)}` : workLabels[turn.outcome];
  return (
    <Row layout={layout}>
      <html.div style={styles.work}>
        <html.button
          aria-expanded={expanded}
          aria-label={label}
          disabled={parts.length === 0 && !live}
          onClick={() => setExpanded(!expanded)}
          style={styles.workButton}
        >
          {live ? <ActivityIndicator size="small" color={theme.muted} /> : null}
          <html.span
            style={[
              textStyles.secondary,
              styles.workLabel,
              failed && styles.workFailed,
              live && styles.workLabelMuted,
            ]}
          >
            {label}
          </html.span>
          {!live && turn.durationMs > 0 ? (
            <html.span style={[textStyles.secondary, styles.workDuration]}>
              {formatDuration(turn.durationMs)}
            </html.span>
          ) : null}
          {parts.length > 0 || live ? (
            <html.div style={styles.chevron(expanded)}>
              <SymbolView
                name="chevron.right"
                size={13}
                weight="semibold"
                tintColor={theme.tertiary}
              />
            </html.div>
          ) : null}
        </html.button>
        {expanded || live ? (
          <html.div style={styles.workBody}>
            {parts.map((part, index) => {
              if (part.kind === "thinking")
                return (
                  <Disclosure
                    key={`${part.commit}-${index}`}
                    title="Reasoning"
                    text={part.text}
                    layout={layout}
                  />
                );
              if (part.kind !== "tool") return null;
              const presentation = presentTool(projectToolView(part));
              if (!part.result?.isError && presentation.body.kind === "diff")
                return <EditRow key={part.callId} part={part} onOpenFile={onOpenFile} />;
              const title =
                part.result === undefined
                  ? `Using ${part.toolName}`
                  : `${part.result.isError ? "Failed: " : ""}${part.result.title ?? part.toolName}`;
              const text = part.result?.output ?? "";
              return <Disclosure key={part.callId} title={title} text={text} layout={layout} />;
            })}
          </html.div>
        ) : null}
      </html.div>
    </Row>
  );
}

function Notice({ text, layout }: { text: string; layout: ConversationLayout }) {
  return (
    <Row layout={layout}>
      <html.p style={[textStyles.secondary, styles.notice]}>{text}</html.p>
    </Row>
  );
}

export const MessageRow = memo(function MessageRow({
  item,
  layout,
  onOpenFile,
}: {
  item: ChatRow;
  layout: ConversationLayout;
  onOpenFile?: (path: string) => void;
}) {
  if ("change" in item)
    return <UserMessage content={item.content} layout={layout} note="Queued on Mac" />;
  switch (item.kind) {
    case "user":
      return <UserMessage content={item.content} layout={layout} />;
    case "assistant":
      return <AssistantMessage text={item.text} layout={layout} />;
    case "stream":
      return <AssistantMessage text={item.text} layout={layout} streaming />;
    case "work":
      return (
        <WorkRow
          turn={item.turn}
          parts={item.parts}
          live={item.live}
          layout={layout}
          onOpenFile={onOpenFile}
        />
      );
    case "summary":
      return <Disclosure title="Conversation summary" text={item.body.text} layout={layout} />;
    case "checkpoint":
      return <Notice text="Earlier context summarized" layout={layout} />;
    case "config":
      return item.body.model ? (
        <Notice text={`Model changed to ${item.body.model.id}`} layout={layout} />
      ) : null;
    case "note":
      return "text" in item ? <Notice text={item.text} layout={layout} /> : null;
    case "tool":
    case "thinking":
      return null;
    default: {
      const exhaustive: never = item;
      return exhaustive;
    }
  }
});

const styles = css.create({
  // Block divs stretch to the list width; an explicit 100% plus padding overflows under content-box sizing.
  row: {},
  gutters: (left: number, right: number) => ({ paddingLeft: left, paddingRight: right }),
  userRow: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: spacing.xs,
    marginTop: spacing.lg,
    paddingBlock: spacing.xs,
  },
  userBubble: {
    backgroundColor: tokens.raised,
    borderRadius: radii.bubble,
    paddingInline: 14,
    paddingBlock: 10,
    gap: spacing.sm,
  },
  bubbleWidth: (maxWidth: number) => ({ maxWidth }),
  image: {
    width: media.thumbnailWidth,
    height: media.thumbnailHeight,
    borderRadius: radii.control,
    objectFit: "cover",
  },
  assistant: {
    display: "flex",
    flexDirection: "column",
    paddingInline: conversation.textInset,
    paddingBlock: 6,
  },
  disclosure: { paddingInline: conversation.textInset, paddingBlock: 6 },
  disclosureButton: {
    opacity: { default: 1, ":active": controls.disabledOpacity },
    borderWidth: 0,
    minHeight: 32,
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  disclosureTitle: { flexShrink: 1 },
  chevron: (expanded: boolean) => ({
    transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
  }),
  disclosureBody: { display: "flex", flexDirection: "column" },
  notice: { paddingInline: conversation.textInset, paddingBlock: 6 },
  work: {
    paddingInline: conversation.textInset,
    paddingBlock: 6,
  },
  workButton: {
    borderWidth: 0,
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: controls.metaTarget,
    opacity: { default: 1, ":active": controls.disabledOpacity },
  },
  workLabel: {},
  workLabelMuted: {},
  workFailed: { color: tokens.danger },
  workDuration: { opacity: 0.7, fontVariant: "tabular-nums" },
  workBody: {
    display: "flex",
    flexDirection: "column",
    paddingLeft: list.leading + spacing.sm,
  },
  editRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: controls.touchTarget,
    borderWidth: 0,
    backgroundColor: { default: "transparent", ":active": tokens.fill },
  },
  editBadge: {
    width: controls.badge,
    height: controls.badge,
    borderRadius: 6,
    backgroundColor: tokens.fill,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  editBadgeText: {
    color: tokens.muted,
    fontSize: 11,
    lineHeight: "14px",
    fontWeight: 600,
  },
  editTitle: {
    flexGrow: 1,
    flexShrink: 1,
    textAlign: "start",
    lineClamp: 1,
    color: tokens.foreground,
  },
  editTotals: { flexShrink: 0, fontVariant: "tabular-nums" },
});
