import { openSecretRequests, SAVE_SECRET_COMMAND } from "@nyte-ai/plugin/secret/schema";
import type { OpenSecretRequest, SaveRequest, SecretDays } from "@nyte-ai/plugin/secret/schema";
import type { ActOutcome, SessionId } from "@nyte-ai/sdk";
import { useMutation } from "@tanstack/react-query";
import { useWaitingDescendants } from "../../chats/index.ts";
import { connection } from "../../data/connection.ts";
import { chatStore } from "../../data/chat-store.ts";
import { useWatchSelect } from "../../data/watch-store.ts";

export interface SecretRequest {
  readonly sessionId: SessionId;
  readonly request: OpenSecretRequest;
  readonly origin: string | undefined;
}

export function useSecretRequest(sessionId: SessionId): SecretRequest | undefined {
  const parts = useWatchSelect(chatStore(sessionId), (state) => state.value?.parts);
  const waiting = useWaitingDescendants(sessionId);
  const [own] = openSecretRequests({ parts: parts ?? [] });

  if (own !== undefined) return { sessionId, request: own, origin: undefined };

  return waiting.flatMap((entry) => {
    const [first] = openSecretRequests(entry.view);

    return first === undefined
      ? []
      : [{ sessionId: entry.id, request: first, origin: entry.title }];
  })[0];
}

export function useSaveSecret() {
  return useMutation({
    mutationKey: ["secret", "save"],
    retry: false,
    mutationFn: async (input: {
      readonly target: SecretRequest;
      readonly value: string;
      readonly days: SecretDays;
    }) => {
      const sent: SaveRequest = {
        part: input.target.request.part,
        value: input.value,
        days: input.days,
      };

      const outcome = await connection()
        .session(input.target.sessionId)
        .command(SAVE_SECRET_COMMAND, JSON.stringify(sent));

      switch (outcome.kind) {
        case "ran":
        case "sent":
          return;
        case "failed":
          throw new Error(outcome.message);
        case "unknown":
          throw new Error("This host can't save secrets from a chat.");
        default: {
          const exhaustive: never = outcome;

          return exhaustive;
        }
      }
    },
  });
}

export function useDismissSecret() {
  return useMutation({
    mutationKey: ["secret", "skip"],
    retry: false,
    mutationFn: async (target: SecretRequest) =>
      requireOk(
        await connection().session(target.sessionId).part(target.request.part).act("skip", {}),
      ),
  });
}

function requireOk(outcome: ActOutcome<unknown>): void {
  switch (outcome.kind) {
    case "ok":
      return;
    case "rejected":
      throw new Error(outcome.reason);
    case "failed":
      throw new Error(outcome.message);
    case "closed":
      throw new Error("This request is no longer waiting.");
    case "no-owner":
    case "unknown-action":
      throw new Error("This host can't take secrets from a chat.");
    default: {
      const exhaustive: never = outcome;

      return exhaustive;
    }
  }
}
