import { SdkError } from "@nyte-ai/schema";
import type { HostId, Revision } from "@nyte-ai/schema";
import { envelope } from "../contract/records.ts";
import type { StoreConnection } from "../contract/store.ts";
import { PROCESSES, processRef } from "../store/refs.ts";
import { dev } from "../util/dev-log.ts";

export const BEAT_MS = 5_000;

export const LAPSE_MS = 20_000;

const FORGET_MS = 10 * 60_000;

const GAP_MS = 3 * BEAT_MS;

export interface Member {
  readonly label: string;
  readonly pid: number | null;
  readonly capabilities: readonly string[];
}

export type Holder =
  | { readonly kind: "me" }
  | { readonly kind: "absent" }
  | { readonly kind: "alive"; readonly until: number }
  | { readonly kind: "dead"; readonly name: string; readonly expect: Revision };

export interface Presence {
  readonly instance: string;
  readonly member: Member;
  readonly store: StoreConnection;
  readonly revoked: AbortSignal;
  holder(instance: string): Promise<Holder>;
  sweep(): Promise<void>;
  close(leases?: readonly { readonly name: string; readonly expect: Revision }[]): Promise<void>;
}

export const REVOKED =
  "Another Nyte took over this one's work while it was paused, so this host stopped; it reopens on its own.";

export async function openPresence(
  raw: StoreConnection,
  input: { readonly instance: string; readonly holder: HostId; readonly member: Member },
): Promise<Presence> {
  const name = processRef(input.instance);

  const body = envelope(
    "process",
    {
      instance: input.instance,
      holder: input.holder,
      label: input.member.label,
      pid: input.member.pid,
      capabilities: [...input.member.capabilities],
      startedAt: Date.now(),
    },
    Date.now(),
  );

  const target = await raw.objects.put(body);
  const registered = await raw.refs.set([{ name, target, expect: "absent" }]);

  if (registered.kind !== "set")
    throw new SdkError("internal", `${name} already exists; process instances must be unique.`);

  let revision = registered.revisions[0];
  const revocation = new AbortController();
  const seen = new Map<string, { revision: Revision; since: number }>();
  let observedAt = performance.now();
  let beating = false;
  let closed = false;

  const revoke = (): void => {
    if (revocation.signal.aborted) return;
    dev("presence", "revoked", { instance: input.instance });
    clearInterval(timer);
    revocation.abort();
  };

  const keepContinuity = (): number => {
    const now = performance.now();

    if (now - observedAt > GAP_MS) for (const entry of seen.values()) entry.since = now;
    observedAt = now;

    return now;
  };

  const observe = (instance: string, current: Revision, now: number) => {
    const known = seen.get(instance);

    if (known !== undefined && known.revision === current) return known;
    const fresh = { revision: current, since: now };
    seen.set(instance, fresh);

    return fresh;
  };

  const beat = async (): Promise<void> => {
    if (beating || closed || revocation.signal.aborted) return;
    beating = true;

    try {
      const outcome = await raw.refs.set([{ name, target, expect: revision }]);

      if (outcome.kind === "set") revision = outcome.revisions[0];
      else revoke();
    } catch (error) {
      dev("presence", "beat failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      beating = false;
    }
  };

  const timer = setInterval(() => void beat(), BEAT_MS);

  const store: StoreConnection = {
    ...raw,
    refs: {
      ...raw.refs,
      async set(updates) {
        if (revocation.signal.aborted) throw new SdkError("unavailable", REVOKED);

        const outcome = await raw.refs.set(
          updates.map((update) => ({ ...update, fences: [...(update.fences ?? []), name] })),
        );

        if (outcome.kind === "fenced" && outcome.name === name) {
          revoke();

          throw new SdkError("unavailable", REVOKED);
        }

        return outcome;
      },
    },
  };

  return {
    instance: input.instance,
    member: input.member,
    store,
    revoked: revocation.signal,
    async holder(instance) {
      if (instance === input.instance) return { kind: "me" };
      const now = keepContinuity();
      const ref = await raw.refs.get(processRef(instance));

      if (ref === null) {
        seen.delete(instance);

        return { kind: "absent" };
      }

      const known = observe(instance, ref.revision, now);

      return now - known.since >= LAPSE_MS
        ? { kind: "dead", name: ref.name, expect: ref.revision }
        : { kind: "alive", until: Date.now() + (LAPSE_MS - (now - known.since)) };
    },
    async sweep() {
      const now = keepContinuity();
      const listed = await raw.refs.list(PROCESSES);
      const present = new Set<string>();

      for (const ref of listed) {
        const instance = ref.name.slice(PROCESSES.length);
        present.add(instance);

        if (instance === input.instance) continue;
        const known = observe(instance, ref.revision, now);

        if (now - known.since < FORGET_MS) continue;
        await raw.refs.set([{ name: ref.name, target: null, expect: ref.revision }]);
        seen.delete(instance);
      }

      for (const instance of seen.keys()) if (!present.has(instance)) seen.delete(instance);

      if (!present.has(input.instance) && !closed) revoke();
    },
    async close(leases = []) {
      if (closed) return;
      closed = true;
      clearInterval(timer);

      if (revocation.signal.aborted) return;

      const leaving = [
        { name, target: null, expect: revision },
        ...leases.map((lease) => ({ name: lease.name, target: null, expect: lease.expect })),
      ];

      const left = await raw.refs.set(leaving).catch(() => null);

      if (left?.kind !== "set")
        await raw.refs.set([{ name, target: null, expect: revision }]).catch(() => undefined);
    },
  };
}
