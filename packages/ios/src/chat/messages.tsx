import { memo, useState } from "react";
import type { ReactNode } from "react";
import { Alert, Linking } from "react-native";
import { SymbolView } from "expo-symbols";
import { css, html } from "react-strict-dom";
import { EnrichedMarkdownText } from "react-native-enriched-markdown";
import type { TurnPart } from "@nyte-ai/protocol";
import type { SessionState } from "@nyte-ai/core/client";
import {
  controls,
  conversation,
  markdownStyle,
  media,
  nativeTheme,
  radii,
  spacing,
  textStyles,
  tokens,
} from "../theme.ts";
import type { ConversationLayout } from "./conversation-layout.ts";
import { CopyButton } from "./copy-button.tsx";
export type ChatRow =
  | TurnPart
  | Exclude<SessionState["transcript"]["items"][number], { kind: "turn" }>
  | SessionState["pending"][number]
  | { kind: "stream"; text: string };

function Markdown({
  text,
  width,
  streaming = false,
}: {
  text: string;
  width: number;
  streaming?: boolean;
}) {
  return (
    <EnrichedMarkdownText
      markdown={text}
      markdownStyle={markdownStyle}
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
        <html.div style={styles.meta}>
          {note ? <html.span style={textStyles.caption}>{note}</html.span> : null}
          <CopyButton text={text} />
        </html.div>
      </html.div>
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
      <html.div style={styles.assistant}>
        <Markdown
          text={text}
          width={layout.contentWidth - conversation.textInset * 2}
          streaming={streaming}
        />
        {streaming ? null : (
          <html.div style={styles.meta}>
            <CopyButton text={text} />
          </html.div>
        )}
      </html.div>
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
  const [expanded, setExpanded] = useState(false);
  return (
    <Row layout={layout}>
      <html.div style={styles.disclosure}>
        <html.button
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          style={styles.disclosureButton}
        >
          <SymbolView
            name={expanded ? "chevron.down" : "chevron.right"}
            size={controls.iconSm}
            weight={controls.iconWeight}
            tintColor={nativeTheme.muted}
          />
          <html.span style={[textStyles.caption, styles.disclosureTitle]}>{title}</html.span>
        </html.button>
        {expanded ? (
          <html.div style={styles.disclosureBody}>
            <Markdown
              text={text}
              width={
                layout.contentWidth - conversation.textInset * 2 - controls.iconSm - spacing.sm
              }
            />
            <html.div style={styles.meta}>
              <CopyButton text={text} label={`Copy ${title}`} />
            </html.div>
          </html.div>
        ) : null}
      </html.div>
    </Row>
  );
}

function Notice({ text, layout }: { text: string; layout: ConversationLayout }) {
  return (
    <Row layout={layout}>
      <html.p style={[textStyles.caption, styles.notice]}>{text}</html.p>
    </Row>
  );
}

export const MessageRow = memo(function MessageRow({
  item,
  layout,
}: {
  item: ChatRow;
  layout: ConversationLayout;
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
    case "thinking":
      return <Disclosure title="Reasoning summary" text={item.text} layout={layout} />;
    case "tool":
      return item.result ? (
        <Disclosure
          title={`${item.result.isError ? "Failed: " : ""}${item.result.title ?? item.toolName}`}
          text={item.result.output}
          layout={layout}
        />
      ) : (
        <Notice text={`Using ${item.toolName}`} layout={layout} />
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
    paddingBlock: spacing.sm,
  },
  userBubble: {
    backgroundColor: tokens.raised,
    borderRadius: radii.bubble,
    paddingInline: spacing.lg,
    paddingBlock: spacing.md,
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
    paddingBlock: spacing.sm,
  },
  meta: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  disclosure: { paddingInline: conversation.textInset, paddingBlock: spacing.xs },
  disclosureButton: {
    opacity: { default: 1, ":active": controls.disabledOpacity },
    borderWidth: 0,
    minHeight: controls.touchTarget,
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  disclosureTitle: { flexShrink: 1 },
  disclosureBody: {
    display: "flex",
    flexDirection: "column",
    paddingLeft: controls.iconSm + spacing.sm,
    paddingBottom: spacing.sm,
  },
  notice: { paddingInline: conversation.textInset, paddingBlock: spacing.md },
});
