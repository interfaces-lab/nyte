import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import { createMMKV, useMMKVString } from "react-native-mmkv";
import type { SessionId } from "@nyte-ai/protocol";
import { useHost } from "../connection/host-context.tsx";

const drafts = createMMKV({ id: "nyte.drafts" });

/** The proven host and principal a draft, receipt or start belongs to. */
export function useChatScope(): string {
  return useHost().scope;
}

export function clearChatDraft({
  scope,
  sessionId,
  submitted,
}: {
  scope: string;
  sessionId?: SessionId;
  submitted: string;
}): void {
  const key = JSON.stringify([scope, sessionId ?? "new"]);

  if (drafts.getString(key) === submitted) drafts.remove(key);
}

export function useChatDraft(sessionId?: SessionId): [string, Dispatch<SetStateAction<string>>] {
  const scope = useChatScope();
  const key = JSON.stringify([scope, sessionId ?? "new"]);
  const [draft, save] = useMMKVString(key, drafts);

  const setDraft = useCallback<Dispatch<SetStateAction<string>>>(
    (next) => {
      save((previous) => {
        const value = typeof next === "function" ? next(previous ?? "") : next;

        return value === "" ? undefined : value;
      });
    },
    [save],
  );

  return [draft ?? "", setDraft];
}
