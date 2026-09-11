import { acceptsSelectionReply } from "@nyte-ai/protocol";
import { isTerminalPhase } from "@nyte-ai/core/views";
import type {
  ParkedCall,
  Selection,
  SelectionReply,
  SessionId,
  SessionSnapshot,
} from "@nyte-ai/core";
import type { JsonValue } from "@nyte-ai/schema";
import { mutationOptions, queryOptions } from "@tanstack/react-query";
import type { NyteBridge } from "../../../shared/ipc.ts";
import { keys } from "../query-keys.ts";

/** A parked call a participant can answer: what it asks them to pick, and where the reply goes. */
export type ParkedSelection = Pick<ParkedCall, "runId" | "callId" | "waitId" | "until"> & {
  readonly selection: Selection;
};

/** Parked calls without a selection are background work, such as a delegated task. */
export function parkedSelections(parked: SessionSnapshot["parked"]): ParkedSelection[] {
  return (parked ?? []).flatMap((call) =>
    call.selection === undefined
      ? []
      : [
          {
            runId: call.runId,
            callId: call.callId,
            waitId: call.waitId,
            selection: call.selection,
            ...(call.until === undefined ? {} : { until: call.until }),
          },
        ],
  );
}

/** Child links are durable; discovery must not depend on ephemeral task progress. */
export function childSelectionOptions(
  sessionId: SessionId,
  sessions: Pick<NyteBridge["sessions"], "list" | "snapshot">,
) {
  return queryOptions({
    queryKey: keys.children(sessionId),
    queryFn: async () => {
      const first = await sessions.list({ parent: sessionId, includeArchived: true });
      const children = [...first.items];
      let cursor = first.next;
      while (cursor !== undefined) {
        const page = await sessions.list({ parent: sessionId, includeArchived: true, cursor });
        children.push(...page.items);
        cursor = page.next;
      }
      return Promise.all(
        children
          .filter((child) =>
            child.heads.some((head) => head.run !== undefined && !isTerminalPhase(head.run.phase)),
          )
          .map(async (child) => {
            const snapshot = await sessions.snapshot({ sessionId: child.sessionId });
            if (snapshot === undefined) throw new Error("Could not read delegated session");
            return {
              sessionId: child.sessionId,
              model:
                child.config.model === undefined
                  ? undefined
                  : `${child.config.model.provider}/${child.config.model.id}`,
              calls: parkedSelections(snapshot.parked),
            };
          }),
      );
    },
    staleTime: 1_000,
    refetchOnMount: true,
    // The parent watch invalidates task progress, but cannot see a child parking later.
    refetchInterval: 5_000,
  });
}

/** A structured reply accepted by the protocol selection carried on the wait. */
export function acceptsReply(selection: Selection, reply: SelectionReply): boolean {
  return acceptsSelectionReply(selection, reply);
}

/** Keep refresh separate from reply acceptance: a failed read must not resend a reply. */
export function selectionReplyOptions(input: {
  readonly sessionId: SessionId;
  readonly call: ParkedSelection;
  readonly reply: NyteBridge["runs"]["reply"];
  readonly refresh: () => Promise<void>;
}) {
  return mutationOptions({
    mutationKey: ["selection", input.sessionId, input.call.waitId],
    retry: false,
    mutationFn: (reply: SelectionReply) => {
      if (!acceptsReply(input.call.selection, reply)) {
        throw new Error("Choose one of the offered answers.");
      }
      const normalized: JsonValue =
        reply.other === undefined
          ? { choices: [...reply.choices] }
          : { choices: [...reply.choices], other: reply.other.trim() };
      return input.reply({
        sessionId: input.sessionId,
        runId: input.call.runId,
        callId: input.call.callId,
        waitId: input.call.waitId,
        reply: normalized,
      });
    },
    onSettled: async () => {
      // The caller presents refresh errors separately from reply errors.
      await input.refresh().catch(() => undefined);
    },
  });
}
