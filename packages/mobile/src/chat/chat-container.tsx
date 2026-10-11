import { useMemo, useState } from "react";
import { Alert, Keyboard } from "react-native";
import { css, html } from "react-strict-dom";
import { router } from "expo-router";
import { Stack } from "expo-router/stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { HeadName, SessionId } from "@nyte-ai/sdk";
import { useHost } from "../connection/host-context.tsx";
import { useWatch } from "../connection/use-watch.ts";
import { describeHostError } from "../connection/connection.ts";
import { navigationMenuAction } from "../ui/navigation-menu.tsx";
import { toast } from "../ui/toast.tsx";
import { TranscriptSkeleton } from "../ui/skeleton.tsx";
import { spacing, textStyles, tokens } from "../theme.ts";
import { openQuestion } from "../view-helpers.ts";
import { useRemoteChat } from "./remote-chat.ts";
import { confirmMergeRequest, MERGE_PROMPT } from "./merge-request.ts";
import { ModelPickerSheet } from "./model-selector.tsx";
import { ChatScreen } from "./chat-screen.tsx";
import { indexDelegateNames } from "./delegate-names.ts";

export function ChatContainer({ sessionId }: { sessionId: SessionId }) {
  const { client } = useHost();
  const insets = useSafeAreaInsets();
  const [head, setHead] = useState<HeadName>();
  const chat = useRemoteChat(client, sessionId, head);

  const [children] = useWatch(
    useMemo(
      () => ({
        watch: () => client.sessions.watch({ parents: { kind: "children", session: sessionId } }),
      }),
      [client, sessionId],
    ),
  );

  const childSessions = children.kind === "ready" ? children.value : undefined;
  const delegateNames = useMemo(() => indexDelegateNames(childSessions ?? []), [childSessions]);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [prefill, setPrefill] = useState<{ text: string; nonce: number }>();
  const execution = chat.state?.execution;
  const finished = execution?.kind === "idle" && execution.lastRun !== null;
  const waiting = chat.state === undefined ? undefined : openQuestion(chat.state);
  const changes = chat.state?.changes ?? [];
  const review = finished && waiting === undefined && changes.length > 0 ? changes : undefined;
  const info = chat.info;
  const session = client.session(sessionId);

  const sendMerge = () => {
    void chat.send(MERGE_PROMPT);
  };

  const report = (title: string) => (cause: unknown) => {
    toast.error(title, describeHostError(cause));
  };

  const name = info?.name?.trim() ?? "";

  const overflow = (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="Conversation options">
        {navigationMenuAction({
          href: `/review/${sessionId}`,
          icon: "checklist",
          children: "Review Changes",
        })}
        {navigationMenuAction({
          href: `/changes/${sessionId}`,
          icon: "doc.text",
          children: "View Changed Files",
        })}
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
              "Rename Conversation",
              undefined,
              (entered) => {
                const trimmed = entered?.trim();

                if (trimmed === undefined || trimmed === "") return;
                void session
                  .update({ name: trimmed })
                  .then(() => chat.reloadInfo())
                  .catch(report("Couldn't rename"));
              },
              "plain-text",
              name,
            );
          }}
        >
          Rename Conversation…
        </Stack.Toolbar.MenuAction>
        <Stack.Toolbar.MenuAction
          icon={info?.pinned === true ? "pin.slash" : "pin"}
          onPress={() => {
            void session
              .update({ pinned: info?.pinned !== true })
              .then(() => chat.reloadInfo())
              .catch(report(info?.pinned === true ? "Couldn't unpin" : "Couldn't pin"));
          }}
        >
          {info?.pinned === true ? "Unpin Conversation" : "Pin Conversation"}
        </Stack.Toolbar.MenuAction>
        <Stack.Toolbar.MenuAction
          icon="trash"
          destructive
          onPress={() => {
            Alert.alert("Delete Conversation", "This can't be undone.", [
              { text: "Cancel", style: "cancel" },
              {
                text: "Delete Conversation",
                style: "destructive",
                onPress: () => {
                  void session
                    .remove()
                    .then((outcome) => {
                      if (outcome.kind === "removed") router.back();
                      else
                        toast.error(
                          "Couldn't delete",
                          outcome.kind === "busy"
                            ? "Stop the conversation first."
                            : "Its subagent conversations are still here.",
                        );
                    })
                    .catch(report("Couldn't delete"));
                },
              },
            ]);
          }}
        >
          Delete Conversation
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
          sessionId={sessionId}
          workspace={info?.workspace}
          head={head ?? "main"}
          onSend={chat.send}
          onStop={chat.stop}
          onReply={chat.reply}
          onReport={chat.report}
          onChooseHead={setHead}
          delegateNames={delegateNames}
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
        />
      </>
    );
  }

  if (chat.error !== undefined) {
    return (
      <html.div style={[styles.centered, styles.topInset(insets.top)]}>
        <html.p role="alert" style={[textStyles.error, styles.centeredText]}>
          {chat.error}
        </html.p>
      </html.div>
    );
  }

  return (
    <html.div style={[styles.loading, styles.topInset(insets.top)]}>
      <TranscriptSkeleton />
    </html.div>
  );
}

const styles = css.create({
  centered: {
    width: "100%",
    height: "100%",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.lg,
    padding: spacing.xl,
    backgroundColor: tokens.canvas,
  },
  topInset: (top: number) => ({ paddingTop: top + spacing.xl }),
  centeredText: { margin: 0, textAlign: "center" },
  loading: {
    width: "100%",
    height: "100%",
    backgroundColor: tokens.canvas,
  },
});
