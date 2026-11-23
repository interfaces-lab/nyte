import { rememberProviderDispatch } from "./provider-checkpoint.ts";
import { SdkError } from "@nyte-ai/schema";
import type { HeadName, RunId, ProviderContinuationId, SessionId } from "@nyte-ai/schema";
import type { Kernel } from "../contract/kernel.ts";
import type {
  ProviderHeadRegistration,
  ProviderRunsApi,
  ProviderRunsTable,
} from "../contract/provider.ts";
import {
  decodeProviderContinuationRecord,
  decodeProviderCheckpointRecord,
  decodeRunRecord,
  decodeSessionRecord,
} from "../contract/records.ts";
import type { ProviderContinuationRecord } from "../contract/records.ts";
import { commit } from "../watch/commit.ts";
import {
  leaseRef,
  parseHeadRef,
  sessionRef,
  providerContinuationRef,
  providerCheckpointRef,
  runRef,
} from "../store/refs.ts";
import { attempt, liveRun, load, put, requireSession, STALE } from "../store/session.ts";
import { newRun } from "./runs.ts";

interface Registration {
  readonly id: string;
  readonly session: SessionId;
  readonly head: HeadName;
  readonly provider: string;
  readonly epoch: number;
  readonly fence: number;
  readonly abort: AbortController;
  readonly order: Map<string, number>;
}

export function createProviderRuns(kernel: Kernel): ProviderRunsTable {
  const registrations = new Map<string, Registration>();
  const key = (session: SessionId, head: HeadName) => leaseRef(session, head);

  const current = (registration: Registration) =>
    registrations.get(key(registration.session, registration.head)) === registration &&
    !registration.abort.signal.aborted &&
    kernel.executionState.held.has(key(registration.session, registration.head));

  const tickets = async (session: SessionId, head: HeadName) => {
    const prefix = providerContinuationRef(session, head, "");
    const refs = await kernel.store.refs.list(prefix);

    return (
      await Promise.all(
        refs.map((ref) => load(kernel.store, ref, decodeProviderContinuationRecord)),
      )
    )
      .filter((found) => found !== null)
      .toSorted((left, right) => left.record.order - right.record.order);
  };

  const valid = async (registration: Registration) => {
    if (!current(registration)) return false;
    const found = await requireSession(kernel.store, registration.session);
    const head = found.record.heads.find((entry) => entry.name === registration.head);

    return (
      head !== undefined &&
      (head.historyEpoch ?? 0) === registration.epoch &&
      (head.providerFence ?? 0) === registration.fence
    );
  };

  const owned = (registration: Registration, record: ProviderContinuationRecord) =>
    record.registration === registration.id &&
    record.instance === kernel.instance &&
    record.provider === registration.provider &&
    record.historyEpoch === registration.epoch &&
    record.fence === registration.fence;

  const claim: ProviderRunsTable["claim"] = (session, head, run, id) =>
    attempt(`Claiming provider continuation ${id}`, async () => {
      const registration = registrations.get(key(session, head));

      if (registration === undefined || !(await valid(registration))) return "stale";
      const name = providerContinuationRef(session, head, id);

      const found = await load(
        kernel.store,
        await kernel.store.refs.get(name),
        decodeProviderContinuationRecord,
      );

      if (found === null || !owned(registration, found.record)) return "stale";

      if (found.record.run !== null) return found.record.run === run ? "claimed" : "stale";

      const outcome = await commit(
        kernel,
        [
          {
            name,
            target: await put(kernel.store, "provider-continuation", { ...found.record, run }),
            expect: found.ref.revision,
            fences: [leaseRef(session, head)],
          },
          ...(await claimCheckpoint(kernel, session, head, run, id)),
        ],
        { session, run },
      );

      if (outcome.kind === "set") rememberProviderDispatch(kernel, run, id);

      return outcome.kind === "stale" ? STALE : outcome.kind === "set" ? "claimed" : "stale";
    });

  const revoke: ProviderRunsTable["revoke"] = async (session, head, reason) => {
    const registration = registrations.get(key(session, head));

    if (registration !== undefined) {
      registrations.delete(key(session, head));
      registration.abort.abort(reason);
    }

    await attempt(`Revoking provider continuations on ${head}`, async () => {
      const found = await tickets(session, head);

      if (found.length === 0) return;

      const outcome = await commit(
        kernel,
        found.map((entry) => ({ name: entry.ref.name, target: null, expect: entry.ref.revision })),
      );

      return outcome.kind === "stale" ? STALE : undefined;
    });
  };

  const bind = async (
    session: SessionId,
    owner: string,
    signal: AbortSignal,
    input: Parameters<ProviderRunsApi["bind"]>[0],
  ): Promise<ProviderHeadRegistration> => {
    const runtime = kernel.plugins.runtime(session);

    if (runtime.instance(owner)?.plugin.provider?.id !== input.provider) {
      throw new SdkError("denied", "Only the owning provider can bind native work.");
    }
    const live = await load(
      kernel.store,
      await kernel.store.refs.get(runRef(session, input.run)),
      decodeRunRecord,
    );

    const found = await requireSession(kernel.store, session);
    const head = found.record.heads.find((entry) => entry.name === input.head);

    if (
      signal.aborted ||
      live === null ||
      live.record.stopping ||
      live.record.view.head !== input.head ||
      head === undefined ||
      (head.historyEpoch ?? 0) !== input.historyEpoch ||
      !kernel.executionState.held.has(key(session, input.head))
    ) {
      throw new SdkError("stale", "The provider no longer owns this head.");
    }

    await revoke(session, input.head, "route");

    const registration: Registration = {
      id: crypto.randomUUID(),
      session,
      head: input.head,
      provider: input.provider,
      epoch: input.historyEpoch,
      fence: head.providerFence ?? 0,
      abort: new AbortController(),
      order: new Map(),
    };

    registrations.set(key(session, input.head), registration);

    const close = () => {
      void revoke(session, input.head, "close");
    };

    signal.addEventListener("abort", close, { once: true });

    return {
      head: input.head,
      provider: input.provider,
      historyEpoch: input.historyEpoch,
      signal: registration.abort.signal,
      offer: (id) => {
        const order = registration.order.get(id) ?? registration.order.size;
        registration.order.set(id, order);

        return attempt(`Offering provider continuation ${id}`, async () => {
          if (!(await valid(registration))) return "stale";
          const name = providerContinuationRef(session, input.head, id);

          const existing = await load(
            kernel.store,
            await kernel.store.refs.get(name),
            decodeProviderContinuationRecord,
          );

          if (existing !== null) {
            return owned(registration, existing.record)
              ? existing.record.run === null
                ? "pending"
                : "claimed"
              : "stale";
          }
          if (
            (await tickets(session, input.head)).filter((ticket) => ticket.record.run === null)
              .length >= 32
          ) {
            throw new SdkError("unavailable", "The agent has too many unread replies.");
          }
          const checkpointName = providerCheckpointRef(session, input.head);

          const checkpoint = await load(
            kernel.store,
            await kernel.store.refs.get(checkpointName),
            decodeProviderCheckpointRecord,
          );

          const record: ProviderContinuationRecord = {
            id,
            head: input.head,
            provider: input.provider,
            historyEpoch: registration.epoch,
            fence: registration.fence,
            instance: kernel.instance,
            registration: registration.id,
            createdAt: Date.now(),
            order,
            run: null,
          };

          const outcome = await commit(kernel, [
            {
              name,
              target: await put(kernel.store, "provider-continuation", record),
              expect: "absent",
              fences: [key(session, input.head)],
            },
            ...(checkpoint?.record.state.kind === "clean"
              ? [
                  {
                    name: checkpointName,
                    expect: checkpoint.ref.revision,
                    target: await put(kernel.store, "provider-checkpoint", {
                      ...checkpoint.record,
                      state: { kind: "uncertain", dispatchId: id, run: input.run },
                    }),
                  },
                ]
              : []),
          ]);

          if (outcome.kind === "stale") return STALE;

          if (outcome.kind === "fenced" || !current(registration)) return "stale";
          kernel.wakes.notify(session, input.head);

          return "pending";
        });
      },
      abandon: async (id) => {
        const found = await load(
          kernel.store,
          await kernel.store.refs.get(providerContinuationRef(session, input.head, id)),
          decodeProviderContinuationRecord,
        );

        if (found !== null && owned(registration, found.record)) {
          await commit(kernel, [
            { name: found.ref.name, target: null, expect: found.ref.revision },
          ]);
        }
      },
      release: async () => {
        signal.removeEventListener("abort", close);

        if (current(registration)) await revoke(session, input.head, "close");
      },
    };
  };

  return {
    async committed(updates) {
      const cuts = updates.flatMap((update) => {
        const owner = parseHeadRef(update.name);

        return owner !== null &&
          update.events?.some((event) => event.kind === "head" && event.reason !== "created") ===
            true
          ? [owner]
          : [];
      });

      await Promise.all(cuts.map((owner) => revoke(owner.session, owner.head, "history")));
    },
    async history(updates) {
      const cuts = updates.flatMap((update) => {
        const owner = parseHeadRef(update.name);

        return owner !== null &&
          update.events?.some((event) => event.kind === "head" && event.reason !== "created") ===
            true
          ? [owner]
          : [];
      });

      if (cuts.length === 0) return updates;
      const sessions = [...new Set(cuts.map((owner) => owner.session))];

      const changed = await Promise.all(
        sessions.map(async (session) => {
          const name = sessionRef(session);
          const existing = updates.findLast((update) => update.name === name);

          if (existing?.target === null) return existing;
          const found = await requireSession(kernel.store, session);

          const original =
            existing?.target == null
              ? found.record
              : decodeSessionRecord(await kernel.store.objects.get(existing.target));

          if (original === null) {
            throw new SdkError("internal", "A head mutation has no session record.");
          }
          const record = {
            ...original,
            heads: original.heads.map((head) =>
              cuts.some((owner) => owner.session === session && owner.head === head.name)
                ? {
                    ...head,
                    historyEpoch: (head.historyEpoch ?? 0) + 1,
                    providerFence: (head.providerFence ?? 0) + 1,
                  }
                : head,
            ),
          };

          return {
            ...existing,
            name,
            target: await put(kernel.store, "session", record),
            expect: existing?.expect ?? found.ref.revision,
          };
        }),
      );

      return [
        ...updates.filter((update) => !changed.some((next) => next.name === update.name)),
        ...changed,
      ];
    },
    api: (session, owner, signal) => ({ bind: (input) => bind(session, owner, signal, input) }),
    held: (session, head) => {
      const registration = registrations.get(key(session, head));

      return registration !== undefined && current(registration);
    },
    claim,
    revoke,
    pending: async (session, head) => {
      const registration = registrations.get(key(session, head));

      return (
        registration !== undefined &&
        (await valid(registration)) &&
        (await tickets(session, head)).some(
          (entry) => owned(registration, entry.record) && entry.record.run === null,
        )
      );
    },
    start: (session, head) =>
      attempt(`Starting provider continuation on ${head}`, async () => {
        const registration = registrations.get(key(session, head));

        if (
          registration === undefined ||
          !(await valid(registration)) ||
          (await liveRun(kernel.store, session, head)) !== null
        ) {
          return null;
        }
        const ticket = (await tickets(session, head)).find(
          (entry) => owned(registration, entry.record) && entry.record.run === null,
        );

        if (ticket === undefined) return null;

        const run = await newRun(kernel.store, session, head, {
          kind: "agent-continued",
          provider: registration.provider,
          continuation: ticket.record.id,
        });

        const outcome = await commit(kernel, [
          ...run.updates,
          {
            name: ticket.ref.name,
            target: await put(kernel.store, "provider-continuation", {
              ...ticket.record,
              run: run.view.id,
            }),
            expect: ticket.ref.revision,
            fences: [key(session, head)],
          },
          ...(await claimCheckpoint(kernel, session, head, run.view.id, ticket.record.id)),
        ]);

        if (outcome.kind === "set") rememberProviderDispatch(kernel, run.view.id, ticket.record.id);

        return outcome.kind === "stale" ? STALE : outcome.kind === "set" ? run.view : null;
      }),
    retire: async () => [],
  };
}

async function claimCheckpoint(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  run: RunId,
  id: ProviderContinuationId,
) {
  const name = providerCheckpointRef(session, head);

  const found = await load(
    kernel.store,
    await kernel.store.refs.get(name),
    decodeProviderCheckpointRecord,
  );

  if (found === null) return [];

  return [
    {
      name,
      target: await put(kernel.store, "provider-checkpoint", {
        ...found.record,
        state: { kind: "uncertain", dispatchId: id, run },
      }),
      expect: found.ref.revision,
    },
  ];
}
