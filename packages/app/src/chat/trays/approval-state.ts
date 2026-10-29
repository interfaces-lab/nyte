import { openApprovals } from "@nyte-ai/plugin/approvals/schema";
import type { ApprovalDecision, OpenApproval } from "@nyte-ai/plugin/approvals/schema";
import type { SessionId } from "@nyte-ai/sdk";
import { useMutation } from "@tanstack/react-query";
import { useWaitingDescendants } from "../../chats/index.ts";
import { connection } from "../../data/connection.ts";
import { sessionWatch } from "../../data/watches.ts";
import { useWatchSelect } from "../../data/watch-store.ts";

export interface ApprovalRequest {
  readonly sessionId: SessionId;
  readonly approval: OpenApproval;
  readonly origin: string | undefined;
}

/** The approval the chat's composer answers: its own first, else the first a chat below it at any depth waits on. */
export function useApprovalRequest(sessionId: SessionId): ApprovalRequest | undefined {
  const parts = useWatchSelect(sessionWatch(sessionId), (state) => state.value?.parts);
  const waiting = useWaitingDescendants(sessionId);
  const [own] = openApprovals({ parts: parts ?? [] });

  if (own !== undefined) return { sessionId, approval: own, origin: undefined };

  return waiting.flatMap((entry) => {
    const [first] = openApprovals(entry.view);

    return first === undefined
      ? []
      : [{ sessionId: entry.chat.id, approval: first, origin: entry.chat.title }];
  })[0];
}

export function useAnswerApproval() {
  return useMutation({
    mutationKey: ["approval", "answer"],
    retry: false,
    mutationFn: async (input: {
      readonly request: ApprovalRequest;
      readonly decision: ApprovalDecision;
    }) => {
      const outcome = await connection()
        .session(input.request.sessionId)
        .part(input.request.approval.part)
        .act(input.decision, {});

      switch (outcome.kind) {
        case "ok":
          return input.request.approval.part;
        case "rejected":
          throw new Error(outcome.reason);
        case "failed":
          throw new Error(outcome.message);
        case "closed":
          throw new Error("This request is no longer waiting.");
        case "no-owner":
        case "unknown-action":
          throw new Error("This host can't answer tool approvals.");
        default: {
          const exhaustive: never = outcome;

          return exhaustive;
        }
      }
    },
  });
}
