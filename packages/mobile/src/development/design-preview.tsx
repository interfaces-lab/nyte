import { ScrollView, View, useWindowDimensions } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { css, html } from "react-strict-dom";
import { asId } from "@nyte-ai/schema";
import type { SessionId, ToolClass, ToolOutcome } from "@nyte-ai/sdk";
import { conversationLayout } from "../chat/conversation-layout.ts";
import { MessageRow } from "../chat/messages.tsx";
import type { ActivityPart, ChatRow } from "../chat/transcript-rows.ts";
import { ToolActivitySheet, useActivitySheet } from "../chat/tool-activity-sheet.tsx";
import { GlassButton } from "../ui/glass-button.tsx";
import { spacing, textStyles, tokens, useTheme } from "../theme.ts";

const delegateNames = new Map<SessionId, string>();

/** Returns a settled tool step for the preview. */
function settledTool(id: string, toolClass: ToolClass, outcome: ToolOutcome): ActivityPart {
  return {
    kind: "tool",
    id,
    state: {
      call: asId<"call">(id),
      name: toolClass.kind,
      args: {},
      class: toolClass,
      phase: "settled",
      outcome,
      changes: null,
    },
    status: { kind: "settled", commit: asId<"commit">(id), endedAt: 0 },
  };
}

/** Returns an ok outcome that said `text`. */
function ok(text: string): ToolOutcome {
  return { kind: "ok", content: [{ kind: "text", text }], output: null, parts: [] };
}

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
      settledTool(
        "preview-read-list",
        { kind: "read", path: "src/inbox/conversation-row.tsx" },
        ok("The conversation row shows the title, preview, and last activity time."),
      ),
      settledTool(
        "preview-read-theme",
        { kind: "read", path: "src/theme.ts" },
        ok("Body text is 17 points. Conversation rows use 16 points of vertical padding."),
      ),
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
      settledTool(
        "preview-typecheck-failed",
        { kind: "shell", command: "pnpm typecheck", description: "Check TypeScript" },
        {
          kind: "failed",
          message: "src/inbox/conversation-row.tsx: Cannot find name 'formatTime'.",
        },
      ),
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
      settledTool(
        "preview-typecheck-passed",
        { kind: "shell", command: "pnpm typecheck", description: "Check TypeScript" },
        ok("TypeScript check passed with no errors."),
      ),
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
