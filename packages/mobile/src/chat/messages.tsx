import { memo, useState } from "react";
import type { ReactNode } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Linking,
  Pressable,
  useColorScheme,
  View,
} from "react-native";
import { setStringAsync } from "expo-clipboard";
import { SymbolView } from "expo-symbols";
import { css, html } from "react-strict-dom";
import remend from "remend";
import { EnrichedMarkdownText } from "react-native-enriched-markdown";
import type { Failure, SessionId, TurnPart, TurnToolClass } from "@nyte-ai/protocol";
import type { SessionState } from "@nyte-ai/client";
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
import { useTranscriptFont } from "../settings/preferences.ts";
import { toast } from "../ui/toast.tsx";
import { elapsed } from "./sessions.ts";
import { formatDuration, type ConversationTurn } from "./turn-changes.ts";
import { delegateTitle } from "./delegate-names.ts";
import { Bubble } from "./bubble.tsx";
import { Marker } from "./marker.tsx";
import { Message, MessageFooter } from "./message.tsx";

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
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const transcriptFont = useTranscriptFont();
  const style = markdownStyle(theme, transcriptFont.value, scheme);

  return (
    <EnrichedMarkdownText
      // remend closes the stream's dangling fences and markers so the tail
      // never renders as literal `**` or an unstyled code dump.
      markdown={streaming ? remend(text) : text}
      markdownStyle={style}
      flavor="github"
      streamingAnimation={streaming}
      enableTaskListItemToggle={false}
      // Native Markdown wraps only against an explicit width.
      containerStyle={{ width }}
      onLinkPress={({ url }) => {
        if (!/^https?:\/\//i.test(url)) return;
        void Linking.openURL(url).catch(() => toast.error("Couldn't open link", url));
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

function copySheet(text: string) {
  ActionSheetIOS.showActionSheetWithOptions(
    { options: ["Cancel", "Copy Message"], cancelButtonIndex: 0 },
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
  const text = Array.isArray(content)
    ? content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
    : content;

  return (
    <Row layout={layout}>
      <Pressable
        accessible
        accessibilityRole="text"
        accessibilityLabel={[
          text,
          Array.isArray(content) && content.some((part) => part.type !== "text")
            ? "Attached photos"
            : undefined,
          note,
        ]
          .filter(Boolean)
          .join(". ")}
        accessibilityActions={text === "" ? [] : [{ name: "copy", label: "Copy Message" }]}
        onAccessibilityAction={({ nativeEvent }) => {
          if (nativeEvent.actionName === "copy") void setStringAsync(text);
        }}
        onLongPress={() => copySheet(text)}
      >
        <Message align="end">
          <Bubble maxWidth={Math.floor(layout.contentWidth * media.bubbleMaxWidthRatio)}>
            {Array.isArray(content) ? (
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
            ) : (
              <html.p style={textStyles.body}>{content}</html.p>
            )}
          </Bubble>
          {note ? <MessageFooter>{note}</MessageFooter> : null}
        </Message>
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
      <Message>
        <Bubble variant="ghost">
          <Markdown
            text={text}
            width={layout.contentWidth - conversation.textInset * 2}
            streaming={streaming}
          />
        </Bubble>
        {!streaming ? (
          <View style={{ alignItems: "flex-start" }}>
            <Pressable
              accessibilityRole="button"
              accessibilityActions={[{ name: "copy", label: "Copy Message" }]}
              onAccessibilityAction={({ nativeEvent }) => {
                if (nativeEvent.actionName === "copy") void setStringAsync(text);
              }}
              onPress={() => void setStringAsync(text)}
              style={{
                minWidth: controls.touchTarget,
                minHeight: controls.touchTarget,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <html.span style={textStyles.caption}>Copy Message</html.span>
            </Pressable>
          </View>
        ) : null}
      </Message>
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
          <SymbolView name="chevron.right" size={11} weight="semibold" tintColor={theme.muted} />
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

/** A settled file edit: status badge, basename, totals, opens the diff. */
function EditRow({
  patch,
  onOpenFile,
}: {
  patch: Extract<TurnToolClass, { kind: "file_patch" }>;
  onOpenFile?: (path: string) => void;
}) {
  const theme = useTheme();
  const basename = patch.path.split("/").pop() ?? patch.path;

  return (
    <html.button onClick={() => onOpenFile?.(patch.path)} style={styles.editRow}>
      <html.div style={styles.editBadge}>
        <html.span style={styles.editBadgeText}>M</html.span>
      </html.div>
      <html.span style={[textStyles.secondary, styles.editTitle]}>{basename}</html.span>
      <html.span style={[textStyles.caption, styles.editTotals]}>
        {`+${String(patch.added)} \u2212${String(patch.removed)}`}
      </html.span>
      <SymbolView name="chevron.right" size={13} tintColor={theme.muted} />
    </html.button>
  );
}

function toolTitle(
  toolClass: TurnToolClass,
  settled: boolean,
  delegateNames: ReadonlyMap<SessionId, string>,
): string {
  switch (toolClass.kind) {
    case "file_read":
      return `${settled ? "Read" : "Reading"} ${toolClass.path}`;
    case "list":
      return `${settled ? "Listed" : "Listing"} ${toolClass.path}`;
    case "shell":
      return `${settled ? "Ran" : "Running"} ${toolClass.description ?? toolClass.command}`;
    case "file_edit":
      return `${settled ? "Edited" : "Editing"} ${toolClass.path}`;
    case "file_write":
      return `${settled ? "Wrote" : "Writing"} ${toolClass.path}`;
    case "file_patch":
      return `${toolClass.op === "edit" ? "Edited" : "Wrote"} ${toolClass.path}`;
    case "delegate":
      return delegateTitle(toolClass, settled, delegateNames);
    case "custom":
      return toolClass.label;
    default: {
      const _exhaustive: never = toolClass;

      return _exhaustive;
    }
  }
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
      return failure.message.replaceAll(/\s+/gu, " ").trim() || "Failed";
    default: {
      const _exhaustive: never = failure.class;

      return _exhaustive;
    }
  }
}

function WorkRow({
  turn,
  parts,
  live,
  layout,
  delegateNames,
  onOpenFile,
}: {
  turn: ConversationTurn;
  parts: TurnPart[];
  live: boolean;
  layout: ConversationLayout;
  delegateNames: ReadonlyMap<SessionId, string>;
  onOpenFile?: (path: string) => void;
}) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [now] = useState(() => Date.now());
  const failed = turn.failure !== undefined && turn.failure.class !== "aborted";

  const label = live
    ? `Responding · ${elapsed(turn.startedAt, now)}`
    : turn.failure === undefined
      ? "Finished"
      : failureLabel(turn.failure);

  return (
    <Row layout={layout}>
      <html.div style={styles.work}>
        <html.button
          aria-expanded={expanded}
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
                tintColor={failed ? theme.danger : theme.muted}
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

              if (part.class.kind === "file_patch" && part.result?.isError === false)
                return <EditRow key={part.callId} patch={part.class} onOpenFile={onOpenFile} />;
              const title = `${part.result?.isError === true ? "Failed: " : ""}${toolTitle(part.class, part.result !== undefined, delegateNames)}`;
              const text = part.result?.output ?? "";

              return <Disclosure key={part.callId} title={title} text={text} layout={layout} />;
            })}
          </html.div>
        ) : null}
      </html.div>
    </Row>
  );
}

export const MessageRow = memo(function MessageRow({
  item,
  layout,
  delegateNames,
  onOpenFile,
}: {
  item: ChatRow;
  layout: ConversationLayout;
  delegateNames: ReadonlyMap<SessionId, string>;
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
          delegateNames={delegateNames}
          onOpenFile={onOpenFile}
        />
      );
    case "summary":
      return <Disclosure title="Conversation summary" text={item.body.text} layout={layout} />;
    case "checkpoint":
      return (
        <Row layout={layout}>
          <Marker>Earlier context summarized</Marker>
        </Row>
      );
    case "config":
      return item.body.model ? (
        <Row layout={layout}>
          <Marker>{`Model changed to ${item.body.model.id}`}</Marker>
        </Row>
      ) : null;
    case "tool":
    case "thinking":
      return null;
    default: {
      const _exhaustive: never = item;

      return _exhaustive;
    }
  }
});

const styles = css.create({
  // Block divs stretch to the list width; an explicit 100% plus padding overflows under content-box sizing.
  row: {},
  gutters: (left: number, right: number) => ({ paddingLeft: left, paddingRight: right }),
  image: {
    width: media.thumbnailWidth,
    height: media.thumbnailHeight,
    borderRadius: radii.control,
    objectFit: "cover",
  },
  disclosure: { paddingInline: conversation.textInset, paddingBlock: 6 },
  disclosureButton: {
    opacity: { default: 1, ":active": controls.disabledOpacity },
    borderWidth: 0,
    minHeight: controls.touchTarget,
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
    minHeight: controls.touchTarget,
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
    display: "flex",
    flexDirection: "column",
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
