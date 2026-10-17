import { useRef, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Alert, Keyboard } from "react-native";
import { router, useNavigation } from "expo-router";
import { createMMKV, useMMKVString } from "react-native-mmkv";
import { css, html } from "react-strict-dom";
import type { WorkspaceInfo } from "@nyte-ai/sdk";
import { useQuery } from "@tanstack/react-query";
import { describeHostError } from "../connection/connection.ts";
import { useHost } from "../connection/host-context.tsx";
import { spacing, textStyles, useTheme } from "../theme.ts";
import { GlassButton } from "../ui/glass-button.tsx";
import { useMountEffect } from "../use-mount-effect.ts";
import {
  askStart,
  canEdit,
  canRetry,
  readAsking,
  parsePendingStart,
  refusalMessage,
  removeStart,
  selectedFolder,
  selectionKey,
  startKey,
  startPreview,
  subscribeAsking,
  type PendingStart,
  type StartInput,
} from "./workspace-start.ts";

export const workspaceStorage = createMMKV({ id: "nyte.workspaces" });

export type RegistryFolders =
  | { kind: "loading" }
  | { kind: "failed"; message: string; refresh: () => void }
  | {
      kind: "ready";
      ready: readonly WorkspaceInfo[];
      selected: WorkspaceInfo | undefined;
      choose: (id: string) => void;
      refresh: () => void;
    };

export function useRegistryFolders(): RegistryFolders {
  const { client, scope } = useHost();
  const [chosenId, setChosenId] = useMMKVString(selectionKey(scope), workspaceStorage);

  const query = useQuery({
    queryKey: ["registered-workspaces"],
    queryFn: () => client.workspaces.list(),
  });

  if (query.isPending) return { kind: "loading" };

  if (query.isError)
    return {
      kind: "failed",
      message: describeHostError(query.error),
      refresh: () => void query.refetch(),
    };

  return {
    kind: "ready",
    ready: query.data.filter((row) => row.availability.kind === "available"),
    selected: selectedFolder(query.data, chosenId),
    choose: setChosenId,
    refresh: () => void query.refetch(),
  };
}

export function usePendingStart(): PendingStart | undefined {
  const { scope } = useHost();
  const [text] = useMMKVString(startKey(scope), workspaceStorage);

  return parsePendingStart(text);
}

const replayed = new Set<string>();

export function useStartSender() {
  const { client, scope } = useHost();
  const navigation = useNavigation();
  const mounted = useRef(true);

  useMountEffect(() => () => {
    mounted.current = false;
  });

  const open = (requestId: string, sessionId: string) => {
    Keyboard.dismiss();
    removeStart(workspaceStorage, scope, requestId);
    router.push(`/chat/${sessionId}`);
  };

  const send = async (input: StartInput, waiting: boolean): Promise<string | undefined> => {
    replayed.add(JSON.stringify([scope, input.requestId]));
    const outcome = await askStart({ client, storage: workspaceStorage, scope, input });

    if (!mounted.current || !navigation.isFocused()) return undefined;

    switch (outcome.kind) {
      case "accepted":
        if (waiting) open(input.requestId, outcome.sessionId);

        return undefined;
      case "refused":
      case "asking":
        return undefined;
      case "unanswered":
        return describeHostError(outcome.cause);
      default: {
        const exhaustive: never = outcome;

        return exhaustive;
      }
    }
  };

  return { send, open, scope };
}

export function PendingStartStrip({
  pending,
  onEdit,
}: {
  pending: PendingStart;
  onEdit: (pending: PendingStart) => void;
}) {
  const theme = useTheme();
  const { send, open, scope } = useStartSender();
  const [error, setError] = useState<string>();
  const { requestId } = pending.input;
  const receipt = pending.receipt;
  const asking = useSyncExternalStore(subscribeAsking, () => readAsking(scope, requestId));

  const retry = (waiting: boolean) => {
    setError(undefined);
    void send(pending.input, waiting).then(setError);
  };

  useMountEffect(() => {
    if (receipt === undefined && !replayed.has(JSON.stringify([scope, requestId]))) retry(false);
  });

  const edit = () => {
    if (receipt !== undefined) {
      onEdit(pending);

      return;
    }

    Alert.alert("Edit message?", "The host may have started this chat already.", [
      { text: "Cancel", style: "cancel" },
      { text: "Edit", onPress: () => onEdit(pending) },
    ]);
  };

  return (
    <html.div style={styles.strip} aria-busy={asking}>
      <html.p style={textStyles.caption}>{`“${startPreview(pending.input)}”`}</html.p>
      {asking ? (
        <html.div style={styles.row} role="status">
          <ActivityIndicator color={theme.muted} size="small" />
          <html.span style={textStyles.caption}>Starting chat…</html.span>
        </html.div>
      ) : (
        <>
          {receipt === undefined ? (
            <html.p role="status" style={textStyles.caption}>
              {error ?? "The host hasn't confirmed this message."}
            </html.p>
          ) : receipt.kind === "accepted" ? (
            <html.p role="status" style={textStyles.caption}>
              Chat started.
            </html.p>
          ) : (
            <html.p role="alert" style={textStyles.error}>
              {refusalMessage(receipt)}
            </html.p>
          )}
          <html.div style={styles.row}>
            {receipt?.kind === "accepted" ? (
              <GlassButton
                label="Open"
                size="compact"
                prominent
                onPress={() => open(requestId, receipt.sessionId)}
              />
            ) : null}
            {canRetry(pending) ? (
              <GlassButton label="Retry" size="compact" onPress={() => retry(true)} />
            ) : null}
            {canEdit(pending) ? <GlassButton label="Edit" size="compact" onPress={edit} /> : null}
          </html.div>
        </>
      )}
    </html.div>
  );
}

const styles = css.create({
  strip: { display: "flex", flexDirection: "column", gap: spacing.xs },
  row: { display: "flex", flexDirection: "row", alignItems: "center", gap: spacing.sm },
});
