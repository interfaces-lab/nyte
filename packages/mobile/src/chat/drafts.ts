import type { Dispatch, SetStateAction } from "react";
import { useMMKVString } from "react-native-mmkv";
import type { SessionId } from "@nyte-ai/sdk";
import { useHost } from "../connection/host-context.tsx";
import { chatDrafts } from "./draft-store.ts";
import { draftKey } from "./send-answer.ts";

export function useChatScope(): string {
  return useHost().scope;
}

export function useChatDraft(sessionId?: SessionId): [string, Dispatch<SetStateAction<string>>] {
  const scope = useChatScope();
  const key = draftKey(scope, sessionId);
  const [draft, save] = useMMKVString(key, chatDrafts);

  const setDraft: Dispatch<SetStateAction<string>> = (next) => {
    save((previous) => {
      const value = typeof next === "function" ? next(previous ?? "") : next;

      return value === "" ? undefined : value;
    });
  };

  return [draft ?? "", setDraft];
}
