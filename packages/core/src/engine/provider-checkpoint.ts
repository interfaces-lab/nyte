import { HOST_CLOSING } from "./durable.ts";
import type { ProviderCheckpointAccess, ProviderHeadRequest } from "@nyte-ai/ai";
import { isJson } from "@nyte-ai/schema";
import type { HeadName, RefUpdate, RunId, SessionId } from "@nyte-ai/schema";
import type { Api, AssistantMessage, Model } from "@nyte-ai/schema/model";
import type { Kernel } from "../contract/kernel.ts";
import {
  decodeProviderCheckpointRecord,
  decodeProviderContinuationRecord,
} from "../contract/records.ts";
import type { ProviderCheckpointRecord, RunRecord } from "../contract/records.ts";
import { walkCommitPath } from "../fold/paths.ts";
import { withFold } from "../watch/reads.ts";
import { commit } from "../watch/commit.ts";
import { leaseRef, providerCheckpointRef, providerContinuationRef } from "../store/refs.ts";
import {
  attempt,
  load,
  put,
  readPositionCommit,
  readRefExpectation,
  requireSession,
  STALE,
} from "../store/session.ts";

const lifetimes = new WeakMap<AbortSignal, AbortSignal>();

export function providerLifetime(signal: AbortSignal): AbortSignal {
  const existing = lifetimes.get(signal);

  if (existing !== undefined) return existing;
  const controller = new AbortController();
  const revoke = () => controller.abort(signal.reason === HOST_CLOSING ? "close" : "stop");
  signal.addEventListener("abort", revoke, { once: true });

  if (signal.aborted) revoke();
  lifetimes.set(signal, controller.signal);

  return controller.signal;
}

const dispatches = new WeakMap<Kernel, Map<RunId, Set<string>>>();

export function rememberProviderDispatch(kernel: Kernel, run: RunId, dispatch: string): void {
  const runs = dispatches.get(kernel) ?? new Map<RunId, Set<string>>();
  const ids = runs.get(run) ?? new Set<string>();
  ids.add(dispatch);
  runs.set(run, ids);
  dispatches.set(kernel, runs);
}

export async function providerCheckpoint(
  kernel: Kernel,
  scope: Omit<ProviderHeadRequest, "checkpoint" | "claimContinuation" | "tools">,
  model: Model<Api>,
): Promise<ProviderCheckpointAccess> {
  const name = providerCheckpointRef(scope.session, scope.head);

  const found = await load(
    kernel.store,
    await kernel.store.refs.get(name),
    decodeProviderCheckpointRecord,
  );

  const compatible =
    found !== null &&
    found.record.provider === model.provider &&
    found.record.api === model.api &&
    found.record.baseModel === model.id &&
    found.record.historyEpoch === scope.history.epoch;

  const state = compatible ? found.record.state : ({ kind: "absent" } as const);

  const ancestor =
    state.kind !== "clean" ||
    (await withFold(kernel, scope.session, (fold) => {
      const anchor = readPositionCommit(state.anchor);

      return (
        anchor === null ||
        walkCommitPath(fold.commits, readPositionCommit(scope.history.tip)).includes(anchor)
      );
    }));

  const admitted = dispatches.get(kernel)?.get(scope.run) ?? new Set<string>();

  return {
    state: ancestor ? state : { kind: "absent" },
    reserve: (input) =>
      attempt(`Reserving provider dispatch on ${scope.head}`, async () => {
        if (scope.lifetime.aborted) return "stale";

        const current = await load(
          kernel.store,
          await kernel.store.refs.get(name),
          decodeProviderCheckpointRecord,
        );

        if (current?.record.state.kind === "uncertain") {
          return current.record.state.run === scope.run &&
            admitted.has(input.dispatchId) &&
            current.record.state.dispatchId === input.dispatchId
            ? "reserved"
            : "uncertain";
        }

        const session = await requireSession(kernel.store, scope.session);
        const head = session.record.heads.find((entry) => entry.name === scope.head);
        const held = kernel.executionState.held.get(leaseRef(scope.session, scope.head));

        if (
          head === undefined ||
          (head.historyEpoch ?? 0) !== scope.history.epoch ||
          held === undefined
        ) {
          return "stale";
        }
        const record: ProviderCheckpointRecord = {
          provider: model.provider,
          api: model.api,
          baseModel: model.id,
          historyEpoch: scope.history.epoch,
          state: { kind: "uncertain", dispatchId: input.dispatchId, run: scope.run },
        };

        const outcome = await commit(
          kernel,
          [
            {
              name,
              target: await put(kernel.store, "provider-checkpoint", record),
              expect: readRefExpectation(current?.ref ?? null),
              fences: [leaseRef(scope.session, scope.head)],
            },
            { name: session.ref.name, target: session.ref.target, expect: session.ref.revision },
          ],
          { session: scope.session, run: scope.run },
        );

        if (outcome.kind === "stale") return STALE;

        if (outcome.kind === "fenced") return "stale";
        rememberProviderDispatch(kernel, scope.run, input.dispatchId);
        admitted.add(input.dispatchId);

        return "reserved";
      }),
  };
}

export function checkpointSeal(
  scope: ProviderHeadRequest,
  model: Model<Api>,
  message: AssistantMessage,
): RunRecord["providerSeal"] {
  const seal = message.sessionCheckpoint;

  if (
    message.providerBoundary !== undefined ||
    (message.stopReason !== "stop" && message.stopReason !== "length")
  ) {
    return undefined;
  }
  if (seal === undefined || !isJson(seal.data)) return undefined;

  return {
    provider: model.provider,
    api: model.api,
    baseModel: model.id,
    historyEpoch: scope.history.epoch,
    dispatchId: seal.dispatchId,
    data: seal.data,
    anchor: scope.history.tip,
  };
}

export async function settledCheckpoint(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  run: RunId,
  seal: RunRecord["providerSeal"],
): Promise<readonly RefUpdate[]> {
  if (seal === undefined) return [];
  const tickets = await kernel.store.refs.list(providerContinuationRef(session, head, ""));

  const pending = await Promise.all(
    tickets.map((ref) => load(kernel.store, ref, decodeProviderContinuationRecord)),
  );

  if (pending.some((ticket) => ticket !== null && ticket.record.run === null)) return [];
  const name = providerCheckpointRef(session, head);

  const found = await load(
    kernel.store,
    await kernel.store.refs.get(name),
    decodeProviderCheckpointRecord,
  );

  if (
    found?.record.state.kind !== "uncertain" ||
    found.record.state.run !== run ||
    found.record.state.dispatchId !== seal.dispatchId ||
    found.record.historyEpoch !== seal.historyEpoch ||
    found.record.provider !== seal.provider ||
    found.record.api !== seal.api ||
    found.record.baseModel !== seal.baseModel
  ) {
    return [];
  }
  return [
    {
      name,
      target: await put(kernel.store, "provider-checkpoint", {
        provider: seal.provider,
        api: seal.api,
        baseModel: seal.baseModel,
        historyEpoch: seal.historyEpoch,
        state: { kind: "clean", anchor: seal.anchor, data: seal.data },
      }),
      expect: found.ref.revision,
    },
  ];
}
