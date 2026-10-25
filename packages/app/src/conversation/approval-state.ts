import { openApprovals } from "@nyte-ai/plugin/approvals/schema";
import type { ApprovalDecision, OpenApproval } from "@nyte-ai/plugin/approvals/schema";
import type { SessionId } from "@nyte-ai/sdk";
import { useMutation } from "@tanstack/react-query";
// oxlint-disable-next-line no-restricted-imports -- the child-session subscription must keep its identity; the compiler drops its memo because the waiting list is read after useSyncExternalStore
import { useMemo, useSyncExternalStore } from "react";
import { useChildSessions } from "../queries.ts";
import { connection, sessionWatch, useWatchSelect } from "../sdk.tsx";

export interface ApprovalRequest {
  readonly sessionId: SessionId;
  readonly approval: OpenApproval;
  readonly origin: string | undefined;
}

function watchChildViews(stores: readonly ReturnType<typeof sessionWatch>[]) {
  let views = stores.map((store) => store.value);

  return {
    subscribe: (notify: () => void) => {
      const leave = stores.map((store) => store.subscribe(notify));

      return () => {
        for (const unsubscribe of leave) unsubscribe();
      };
    },
    snapshot: () => {
      const next = stores.map((store) => store.value);

      if (next.some((view, index) => view !== views[index])) views = next;

      return views;
    },
  };
}

export function useApprovalRequest(sessionId: SessionId): ApprovalRequest | undefined {
  const parts = useWatchSelect(sessionWatch(sessionId), (state) => state.value?.parts);
  const children = useChildSessions(sessionId);

  const waiting = useMemo(
    () =>
      (children.data ?? []).flatMap((child) => {
        const execution = child.heads[0]?.execution;

        return execution?.kind === "waiting" && execution.on.kind === "part"
          ? [{ child, store: sessionWatch(child.id) }]
          : [];
      }),
    [children.data],
  );

  const observation = useMemo(() => watchChildViews(waiting.map(({ store }) => store)), [waiting]);

  const childViews = useSyncExternalStore(
    observation.subscribe,
    observation.snapshot,
    observation.snapshot,
  );

  const [own] = openApprovals({ parts: parts ?? [] });

  if (own !== undefined) return { sessionId, approval: own, origin: undefined };

  for (const [index, waiter] of waiting.entries()) {
    const [first] = openApprovals(childViews[index]);

    if (first !== undefined)
      return {
        sessionId: waiter.child.id,
        approval: first,
        origin: waiter.child.name ?? "a subagent",
      };
  }

  return undefined;
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
