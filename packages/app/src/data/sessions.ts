import { useMutation, useMutationState } from "@tanstack/react-query";
import { useState } from "react";
import type { SessionId, SessionInfo } from "@nyte-ai/sdk";
import type { ChatView } from "./chat-store.ts";
import { projectSessionChoice, sessionConfigurationOptions } from "./session-configuration.ts";
import type { PendingConfiguration } from "./session-configuration.ts";
import { chatStore } from "./chat-store.ts";
import { sessionSearch } from "./directory.ts";
import { useWatch, useWatchSelect } from "./watch-store.ts";
import { subagentActivity } from "./session-activity.ts";

/** Asks the host for the newest roots named like `search` on each change, and keeps the last answer on screen until the next one arrives, so typing never blanks the list. */
export function useSessionSearch(search: string, enabled = true) {
  const needle = search.trim();
  const found = useWatch(enabled && needle !== "" ? sessionSearch(needle) : undefined).value;
  const [shown, setShown] = useState<readonly SessionInfo[] | undefined>(found);

  if (found !== undefined && found !== shown) setShown(found);
  const items = enabled && needle !== "" ? (found ?? shown) : undefined;

  return {
    data: items === undefined ? undefined : { items: items.filter((session) => !session.archived) },
  };
}

export function useSessionView(sessionId: SessionId | undefined): ChatView | undefined {
  return useWatch(sessionId === undefined ? undefined : chatStore(sessionId)).value;
}

export function useSessionActivity(
  sessionId: SessionId | undefined,
  cwd: string | undefined,
): string | undefined {
  return useWatchSelect(sessionId === undefined ? undefined : chatStore(sessionId), (state) =>
    subagentActivity(state.value?.activity, cwd),
  );
}

export function useSessionChoice(sessionId: SessionId) {
  const configuration = useWatchSelect(chatStore(sessionId), (state) => state.value?.configuration);

  const pending = useMutationState<PendingConfiguration>({
    filters: { mutationKey: ["session", sessionId, "configure"], status: "pending" },
  });

  return configuration === undefined ? undefined : projectSessionChoice({ configuration }, pending);
}

export function useConfigureSession(sessionId: SessionId) {
  return useMutation(sessionConfigurationOptions({ sessionId }));
}
