import { openApprovals } from "@nyte-ai/plugin/approvals/schema";
import type { ApprovalDecision, OpenApproval } from "@nyte-ai/plugin/approvals/schema";
import type { SessionId } from "@nyte-ai/sdk";
import { useMutation } from "@tanstack/react-query";
import { useWaitingDescendants } from "../../chats/index.ts";
import { connection } from "../../data/connection.ts";
import { chatStore } from "../../data/chat-store.ts";
import { useWatchSelect } from "../../data/watch-store.ts";
import { openAsks, requireAnswered } from "./asks.ts";

export interface ApprovalRequest {
  readonly sessionId: SessionId;
  readonly approval: OpenApproval;
  readonly origin: string | undefined;
}

export function useApprovalRequest(sessionId: SessionId): ApprovalRequest | undefined {
  const parts = useWatchSelect(chatStore(sessionId), (state) => state.value?.parts);
  const waiting = useWaitingDescendants(sessionId);
  const [first] = openAsks(openApprovals, { sessionId, parts }, waiting);

  return first === undefined
    ? undefined
    : { sessionId: first.sessionId, approval: first.request, origin: first.origin?.title };
}

export function useAnswerApproval() {
  return useMutation({
    mutationKey: ["approval", "answer"],
    retry: false,
    mutationFn: async (input: {
      readonly request: ApprovalRequest;
      readonly decision: ApprovalDecision;
    }) => {
      requireAnswered(
        await connection()
          .session(input.request.sessionId)
          .part(input.request.approval.part)
          .act(input.decision, {}),
        "approval",
      );

      return input.request.approval.part;
    },
  });
}
