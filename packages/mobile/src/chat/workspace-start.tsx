import { useRef, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Alert, Keyboard } from "react-native";
import { router, useNavigation } from "expo-router";
import { createMMKV, useMMKVString } from "react-native-mmkv";
import { css, html } from "react-strict-dom";
import type { RegisteredWorkspace, SessionId, StartInput } from "@nyte-ai/protocol";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { describeHostError } from "../connection/connection.ts";
import { useHost } from "../connection/host-context.tsx";
import { spacing, textStyles, useTheme } from "../theme.ts";
import { GlassButton } from "../ui/glass-button.tsx";
import { useMountEffect } from "../use-mount-effect.ts";
import {
  askStart,
  canEdit,
  canRetry,
  isAsking,
  isReady,
  parsePendingStart,
  refusalMessage,
  removeStart,
  selectedFolder,
  selectionKey,
  startKey,
  startPreview,
  subscribeAsking,
  type PendingStart,
} from "./workspace-start.ts";

export const workspaceStorage = createMMKV({ id: "nyte.workspaces" });

export type RegistryFolders =
  | { kind: "loading" }
  | { kind: "failed"; message: string; refresh: () => void }
  | {
      kind: "ready";
      ready: readonly RegisteredWorkspace[];
      selected: RegisteredWorkspace | undefined;
      choose: (id: string) => void;
      refresh: () => void;
    };

/** This phone's folder on a registry host; undefined on a cursor host. */
export function useRegistryFolders(): RegistryFolders | undefined {
  const { client, info, scope } = useHost();
  const registry = info.workspaces?.kind === "registry";
  const [chosenId, setChosenId] = useMMKVString(selectionKey(scope), workspaceStorage);

  const query = useQuery({
    queryKey: ["registered-workspaces"],
    enabled: registry,
    queryFn: () => client.environment("environment.workspaces.list", undefined),
  });

  if (!registry) return undefined;

  if (query.isPending) return { kind: "loading" };

  if (query.isError)
    return {
      kind: "failed",
      message: describeHostError(query.error),
      refresh: () => void query.refetch(),
    };

  return {
    kind: "ready",
    ready: query.data.filter(isReady),
    selected: selectedFolder(query.data, chosenId),
    choose: setChosenId,
    refresh: () => void query.refetch(),
  };
}

/** The start waiting on this host, if any; it re-renders as the record changes. */
export function usePendingStart(): PendingStart | undefined {
  const { scope } = useHost();
  const [text] = useMMKVString(startKey(scope), workspaceStorage);

  return parsePendingStart(text);
}

/** Starts this process already re-asked about after a launch or reconnect. */
const replayed = new Set<string>();

/**
 * Sends recorded starts for the screen that calls it. The answer always lands
 * in this host's record; only a screen still mounted and in front opens the
 * accepted chat, and anything else leaves it on the record to open later.
 */
export function useStartSender() {
  const { client, scope } = useHost();
  const queryClient = useQueryClient();
  const navigation = useNavigation();
  const mounted = useRef(true);

  useMountEffect(() => () => {
    mounted.current = false;
  });

  const open = (requestId: string, sessionId: SessionId) => {
    Keyboard.dismiss();
    removeStart(workspaceStorage, scope, requestId);
    router.push(`/chat/${sessionId}`);
  };

  /** Resolves to a message for the composer when the host did not answer. */
  const send = async (input: StartInput, waiting: boolean): Promise<string | undefined> => {
    replayed.add(JSON.stringify([scope, input.requestId]));
    const outcome = await askStart({ client, storage: workspaceStorage, scope, input });

    if (!mounted.current || !navigation.isFocused()) return undefined;

    switch (outcome.kind) {
      case "accepted":
        void queryClient.invalidateQueries({ queryKey: ["sessions"] });

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

/**
 * The new-chat message this host has not finished with: unanswered, refused,
 * or started and not yet opened. Retry sends the same record; Edit gives an
 * unstarted message back to the composer.
 */
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
  const asking = useSyncExternalStore(subscribeAsking, () => isAsking(scope, requestId));

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
