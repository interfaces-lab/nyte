import { ScrollView, View, useWindowDimensions } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { css, html } from "react-strict-dom";
import type { SessionId } from "@nyte-ai/protocol";
import { conversationLayout } from "../chat/conversation-layout.ts";
import { MessageRow } from "../chat/messages.tsx";
import type { ChatRow } from "../chat/transcript-rows.ts";
import { ToolActivitySheet, useActivitySheet } from "../chat/tool-activity-sheet.tsx";
import { GlassButton } from "../ui/glass-button.tsx";
import { spacing, textStyles, tokens, useTheme } from "../theme.ts";

const delegateNames = new Map<SessionId, string>();

const rows: readonly ChatRow[] = [
  { kind: "marker", id: "preview-date", text: "Today" },
  {
    kind: "user",
    id: "preview-request",
    content: "Can you make the inbox easier to scan?",
    delivery: "sent",
  },
  {
    kind: "assistant",
    id: "preview-acknowledgement",
    text: "I'll check the conversation list and spacing first.",
    streaming: false,
  },
  {
    kind: "activity",
    id: "preview-reading",
    parts: [
      {
        kind: "tool",
        progress: undefined,
        tool: {
          kind: "tool",
          callId: "preview-read-list",
          at: 0,
          class: { kind: "file_read", path: "src/inbox/conversation-row.tsx" },
          state: { kind: "success", commit: "preview-read-list-result" },
          output: "The conversation row shows the title, preview, and last activity time.",
        },
      },
      {
        kind: "tool",
        progress: undefined,
        tool: {
          kind: "tool",
          callId: "preview-read-theme",
          at: 0,
          class: { kind: "file_read", path: "src/theme.ts" },
          state: { kind: "success", commit: "preview-read-theme-result" },
          output: "Body text is 17 points. Conversation rows use 16 points of vertical padding.",
        },
      },
    ],
  },
  {
    kind: "assistant",
    id: "preview-result",
    text: "The latest message now sits below the title, with the time on the right. Working chats stay easy to spot.",
    streaming: false,
  },
  {
    kind: "user",
    id: "preview-check-request",
    content: "Did the checks pass?",
    delivery: "sent",
  },
  {
    kind: "activity",
    id: "preview-failed-check",
    parts: [
      {
        kind: "tool",
        progress: undefined,
        tool: {
          kind: "tool",
          callId: "preview-typecheck-failed",
          at: 0,
          class: {
            kind: "shell",
            command: "pnpm typecheck",
            description: "Check TypeScript",
            facts: { durationMs: 1420, truncated: false },
          },
          state: {
            kind: "error",
            reason: { kind: "exit", code: 1 },
            commit: "preview-typecheck-error",
          },
          output: "src/inbox/conversation-row.tsx: Cannot find name 'formatTime'.",
        },
      },
    ],
  },
  {
    kind: "assistant",
    id: "preview-recovery",
    text: "The first check caught a missing import. I've fixed it and will check again.",
    streaming: false,
  },
  {
    kind: "activity",
    id: "preview-passed-check",
    parts: [
      {
        kind: "tool",
        progress: undefined,
        tool: {
          kind: "tool",
          callId: "preview-typecheck-passed",
          at: 0,
          class: {
            kind: "shell",
            command: "pnpm typecheck",
            description: "Check TypeScript",
            facts: { durationMs: 1180, truncated: false },
          },
          state: { kind: "success", commit: "preview-typecheck-result" },
          output: "TypeScript check passed with no errors.",
        },
      },
    ],
  },
  {
    kind: "assistant",
    id: "preview-finished",
    text: "The check passes now. Ready for you to try.",
    streaming: false,
  },
];

function PreviewContent({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const layout = conversationLayout(width, insets);
  const activity = useActivitySheet(rows);

  return (
    <View style={{ flex: 1, backgroundColor: theme.canvas }}>
      <View
        style={{
          paddingTop: insets.top + spacing.sm,
          paddingLeft: insets.left + spacing.gutter,
          paddingRight: insets.right + spacing.gutter,
        }}
      >
        <html.div style={styles.header}>
          <html.span role="heading" aria-level={1} style={[textStyles.title, styles.title]}>
            Design preview
          </html.span>
          <GlassButton label="Done" onPress={onClose} />
        </html.div>
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{ paddingTop: spacing.md, paddingBottom: spacing.xl }}
      >
        {rows.map((item) => (
          <MessageRow
            key={item.id}
            item={item}
            layout={layout}
            delegateNames={delegateNames}
            onOpenActivity={activity.openActivity}
          />
        ))}
      </ScrollView>
      <View
        style={{
          paddingBottom: Math.max(insets.bottom, spacing.lg),
          paddingLeft: insets.left + spacing.gutter,
          paddingRight: insets.right + spacing.gutter,
        }}
      >
        <html.div style={styles.footer}>
          <html.p style={[textStyles.secondary, styles.note]}>
            Connect your Mac to try messaging.
          </html.p>
        </html.div>
      </View>
      <ToolActivitySheet
        open={activity.open}
        parts={activity.parts}
        delegateNames={delegateNames}
        onClose={activity.close}
      />
    </View>
  );
}

export function DesignPreview({ onClose }: { onClose: () => void }) {
  return (
    <SafeAreaProvider>
      <PreviewContent onClose={onClose} />
    </SafeAreaProvider>
  );
}

const styles = css.create({
  header: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: { flexShrink: 1 },
  footer: {
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.separator,
  },
  note: { margin: 0, textAlign: "center" },
});
