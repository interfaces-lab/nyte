import { useMutation, useMutationState, useQuery } from "@tanstack/react-query";
import type { MutationState } from "@tanstack/react-query";
import type { ClientCommandName } from "@nyte-ai/schema";
import { toast } from "@nyte-ai/ui/toast";
import type { CommandInfo, Json, SessionId, SettingInfo, WorkspaceId } from "@nyte-ai/sdk";
import { keys } from "./query-client.ts";
import { chatStore } from "./chat-store.ts";
import { connected } from "./connection.ts";
import { useWatchSelect } from "./watch-store.ts";

export function useWorkspaceCatalog(workspace: WorkspaceId | undefined) {
  return useQuery({
    queryKey: keys.workspaceCatalog(workspace),
    queryFn: async () => {
      if (workspace === undefined) throw new Error("Open a workspace to list its skills");

      return (await connected()).workspace(workspace).catalog();
    },
    enabled: workspace !== undefined,
    staleTime: 10_000,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });
}

export const COMPACT_COMMAND = {
  name: "compact" satisfies ClientCommandName,
  owner: "",
  side: "client",
  title: "Compact",
  description: "Summarize the chat to free up context",
  takesText: false,
  completes: false,
} satisfies CommandInfo;

export const SIDECHAT_COMMAND = {
  name: "sidechat" satisfies ClientCommandName,
  owner: "",
  side: "client",
  title: "Side Chat",
  description: "Ask in a side chat without interrupting this one",
  takesText: true,
  completes: false,
} satisfies CommandInfo;

/** The commands Nyte's app runs itself, offered beside the chat's plugin commands. */
export const CLIENT_COMMANDS: readonly CommandInfo[] = [COMPACT_COMMAND, SIDECHAT_COMMAND];

export function usePluginCatalog(sessionId?: SessionId) {
  const store = sessionId === undefined ? undefined : chatStore(sessionId);
  const catalog = useWatchSelect(store, (state) => state.value?.catalog);

  const failed = useWatchSelect(
    store,
    (state) => state.value === undefined && state.error !== undefined,
  );

  const data =
    catalog === undefined
      ? undefined
      : { ...catalog, commands: [...catalog.commands, ...CLIENT_COMMANDS] };

  return { data, isError: failed };
}

interface ApplyPluginSettingInput {
  readonly id: string;
  readonly value: Json;
}

export function usePluginSettingsProjection(sessionId: SessionId | undefined) {
  const pending = useMutationState<MutationState<void, Error, ApplyPluginSettingInput>>({
    filters: { mutationKey: ["plugins", "apply", sessionId], status: "pending" },
  });

  return (settings: readonly SettingInfo[]): readonly SettingInfo[] =>
    pending.reduce((current, mutation) => {
      const input = mutation.variables;

      return input === undefined
        ? current
        : current.map((setting) =>
            setting.id === input.id ? { ...setting, value: input.value } : setting,
          );
    }, settings);
}

export function useApplyPluginSetting(sessionId: SessionId | undefined) {
  return useMutation({
    mutationKey: ["plugins", "apply", sessionId],
    networkMode: "always",
    mutationFn: async ({ id, value }: ApplyPluginSettingInput) => {
      if (sessionId === undefined) {
        const outcome = await (await connected()).settings.apply(id, value);

        if (outcome.kind === "unknown") throw new Error("That setting is no longer available");

        if (outcome.kind === "invalid") throw new Error("That setting value is not valid");

        return;
      }

      const outcome = await (
        await connected()
      )
        .session(sessionId)
        .configure({ settings: { [id]: value } });

      if (outcome.kind === "invalid") throw new Error("That setting value is not valid");

      if (outcome.kind !== "configured") throw new Error("That setting is no longer available");
    },
    onError: () =>
      toast.add({
        type: "error",
        title: "Couldn't change that setting. Try again.",
        id: "plugin-setting-error",
      }),
  });
}
