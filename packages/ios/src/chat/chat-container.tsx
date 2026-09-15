import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Keyboard } from "react-native";
import { css, html } from "react-strict-dom";
import { router } from "expo-router";
import { Stack } from "expo-router/stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isTerminalPhase } from "@nyte-ai/protocol";
import type { SessionId } from "@nyte-ai/protocol";
import { waitingCall } from "@nyte-ai/core/client";
import { useHost } from "../connection/host-context.tsx";
import { describeHostError } from "../connection/connection.ts";
import { useTheme, spacing, textStyles, tokens } from "../theme.ts";
import { useRemoteChat } from "./remote-chat.ts";
import { conversationChanges } from "./turn-changes.ts";
import { confirmMergeRequest, MERGE_PROMPT } from "./merge-request.ts";
import { ModelPickerSheet } from "./model-selector.tsx";
import { ChatScreen } from "./chat-screen.tsx";

export function ChatContainer({ sessionId }: { sessionId: SessionId }) {
  const theme = useTheme();
  const { client } = useHost();
  const insets = useSafeAreaInsets();
  const chat = useRemoteChat(client, sessionId);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [prefill, setPrefill] = useState<{ text: string; nonce: number }>();
  const run = chat.state?.run;
  const finished = run !== undefined && isTerminalPhase(run.phase);
  const waiting = chat.state === undefined ? undefined : waitingCall(chat.state);
  const changes = useMemo(
    () => conversationChanges(chat.state?.transcript.items ?? []),
    [chat.state],
  );
  const review = finished && waiting === undefined && changes.length > 0 ? changes : undefined;
  const info = chat.state?.info;

  const sendMerge = () => {
    void chat.send(MERGE_PROMPT);
  };

  const report = (title: string) => (cause: unknown) => {
    Alert.alert(title, describeHostError(cause));
  };

  const name = info?.name?.trim() ?? "";

  const overflow = (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="Conversation options">
        <Stack.Toolbar.MenuAction
          icon="checklist"
          onPress={() => {
            Keyboard.dismiss();
            router.push(`/review/${sessionId}`);
          }}
        >
          Review
        </Stack.Toolbar.MenuAction>
        <Stack.Toolbar.MenuAction
          icon="doc.text"
          onPress={() => {
            Keyboard.dismiss();
            router.push(`/changes/${sessionId}`);
          }}
        >
          Changed Files
        </Stack.Toolbar.MenuAction>
        <Stack.Toolbar.MenuAction
          icon="cpu"
          onPress={() => {
            Keyboard.dismiss();
            setModelPickerOpen(true);
          }}
        >
          Model…
        </Stack.Toolbar.MenuAction>
        <Stack.Toolbar.MenuAction
          icon="pencil"
          onPress={() => {
            Alert.prompt(
              "Rename conversation",
              undefined,
              (entered) => {
                const trimmed = entered?.trim();
                if (trimmed === undefined || trimmed === "") return;
                void client.sessions
                  .rename({ sessionId, name: trimmed })
                  .catch(report("Couldn't rename"));
              },
              "plain-text",
              name,
            );
          }}
        >
          Rename…
        </Stack.Toolbar.MenuAction>
        <Stack.Toolbar.MenuAction
          icon={info?.pinned === true ? "pin.slash" : "pin"}
          onPress={() => {
            void client.sessions
              .setPinned({ sessionId, pinned: info?.pinned !== true })
              .catch(report(info?.pinned === true ? "Couldn't unpin" : "Couldn't pin"));
          }}
        >
          {info?.pinned === true ? "Unpin" : "Pin"}
        </Stack.Toolbar.MenuAction>
        <Stack.Toolbar.MenuAction
          icon="trash"
          destructive
          onPress={() => {
            Alert.alert("Delete this conversation?", "This can't be undone.", [
              { text: "Cancel", style: "cancel" },
              {
                text: "Delete",
                style: "destructive",
                onPress: () => {
                  void client.sessions
                    .delete({ sessionId })
                    .then(() => router.back())
                    .catch(report("Couldn't delete"));
                },
              },
            ]);
          }}
        >
          Delete
        </Stack.Toolbar.MenuAction>
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
  );

  if (chat.state !== undefined) {
    return (
      <>
        <Stack.Title>{name === "" ? "Conversation" : name}</Stack.Title>
        {overflow}
        <ModelPickerSheet
          client={client}
          open={modelPickerOpen}
          onClose={() => setModelPickerOpen(false)}
          selectedModel={chat.selectedModel}
          selectingModel={chat.selectingModel}
          modelError={chat.modelError}
          onSelect={chat.selectModel}
        />
        <ChatScreen
          {...chat}
          state={chat.state}
          onSend={chat.send}
          onStop={chat.stop}
          onReply={chat.reply}
          changes={review}
          prefill={prefill}
          onAskMerge={() =>
            confirmMergeRequest({
              onSend: sendMerge,
              onEdit: () =>
                setPrefill((current) => ({
                  text: MERGE_PROMPT,
                  nonce: (current?.nonce ?? 0) + 1,
                })),
            })
          }
          onOpenReview={() => router.push(`/review/${sessionId}`)}
        />
      </>
    );
  }

  return (
    <html.div style={[styles.centered, styles.topInset(insets.top)]}>
      {chat.error !== undefined ? (
        <html.p role="alert" style={[textStyles.error, styles.centeredText]}>
          {chat.error}
        </html.p>
      ) : (
        <ActivityIndicator color={theme.muted} />
      )}
    </html.div>
  );
}

const styles = css.create({
  centered: {
    flexGrow: 1,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.lg,
    padding: spacing.xl,
    backgroundColor: tokens.canvas,
  },
  topInset: (top: number) => ({ paddingTop: top + spacing.xl }),
  centeredText: { margin: 0, textAlign: "center" },
});
