import { asId, SdkError } from "@nyte-ai/schema";
import type { ClientId, ClientRow, Json, PrincipalId, SdkErrorCode } from "@nyte-ai/schema";
import type { ServerHost } from "@nyte-ai/core/server";

export type Requester = { readonly client: ClientId; readonly principal: PrincipalId };

export type Outcome = "performed" | "refused" | "failed" | "timeout";

export type PerformEvent = {
  readonly c: "e";
  readonly type: "event";
  readonly scope: string;
  readonly seq: number;
  readonly kind: "perform";
  readonly call: string;
  readonly requester: Requester;
  readonly action: string;
  readonly input: Json;
};

export type HostEvent =
  | {
      readonly c: "e";
      readonly type: "event";
      readonly scope: "host";
      readonly seq: null;
      readonly kind: "live";
      readonly clients: readonly ClientRow[];
    }
  | {
      readonly c: "e";
      readonly type: "event";
      readonly scope: "host";
      readonly seq: null;
      readonly kind: "performed";
      readonly call: string;
      readonly target: ClientId;
      readonly outcome: Outcome;
    };

export type Reply =
  | { readonly kind: "result"; readonly result: Json }
  | { readonly kind: "error"; readonly code: SdkErrorCode; readonly message: string };

export type ClientMember = {
  readonly row: ClientRow;
  deliver(event: PerformEvent): void;
};

export type Clients = {
  rows(): readonly ClientRow[];
  join(member: ClientMember): { listen(listening: boolean): void; leave(): void };
  observe(listener: (event: HostEvent) => void): () => void;
  perform(
    requester: Requester,
    request: {
      readonly client: ClientId;
      readonly action: string;
      readonly input: Json;
      readonly timeoutMs?: number;
    },
  ): Promise<Json>;
  reply(from: ClientId, call: string, reply: Reply): void;
};

type Pending = {
  readonly call: string;
  readonly requester: Requester;
  readonly action: string;
  readonly input: Json;
  readonly timeoutMs: number;
  readonly settle: (outcome: Reply | null, failure: SdkError | null) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
  delivered: boolean;
};

type Entry = {
  readonly member: ClientMember;
  readonly waiting: Pending[];
  current: Pending | null;
  listening: boolean;
  seq: number;
};

const HOST_REQUESTER: Requester = {
  client: asId<"client">("host"),
  principal: asId<"principal">("local"),
};

const DEFAULT_TIMEOUT_MS = 10_000;

const MAX_TIMEOUT_MS = 30_000;

const MAX_WAITING = 16;

const shared = new WeakMap<ServerHost, Clients>();

export function sharedClients(server: ServerHost): Clients {
  const known = shared.get(server);

  if (known !== undefined) return known;
  const created = openClients();
  shared.set(server, created);

  return created;
}

function openClients(): Clients {
  const entries = new Map<ClientId, Entry>();
  const observers = new Set<(event: HostEvent) => void>();

  const rows = (): readonly ClientRow[] =>
    Array.from(entries.values(), (entry) => entry.member.row);

  const broadcast = (event: HostEvent): void => {
    for (const observer of observers) observer(event);
  };

  const announce = (): void =>
    broadcast({ c: "e", type: "event", scope: "host", seq: null, kind: "live", clients: rows() });

  const performed = (call: string, target: ClientId, outcome: Outcome): void =>
    broadcast({
      c: "e",
      type: "event",
      scope: "host",
      seq: null,
      kind: "performed",
      call,
      target,
      outcome,
    });

  const deliver = (entry: Entry): void => {
    const pending = entry.current;

    if (pending === null || pending.delivered || !entry.listening) return;
    pending.delivered = true;
    entry.seq += 1;
    entry.member.deliver({
      c: "e",
      type: "event",
      scope: `client/${entry.member.row.id}`,
      seq: entry.seq,
      kind: "perform",
      call: pending.call,
      requester: pending.requester,
      action: pending.action,
      input: pending.input,
    });
  };

  const advance = (entry: Entry): void => {
    if (entry.current !== null) return;
    const next = entry.waiting.shift();

    if (next === undefined) return;
    entry.current = next;
    next.timer = setTimeout(() => {
      finish(
        entry,
        next,
        null,
        new SdkError(
          "timeout",
          `The client did not answer ${next.action} in ${next.timeoutMs} ms.`,
        ),
      );
    }, next.timeoutMs);
    deliver(entry);
  };

  const finish = (
    entry: Entry,
    pending: Pending,
    reply: Reply | null,
    failure: SdkError | null,
  ): void => {
    clearTimeout(pending.timer);

    if (entry.current === pending) entry.current = null;
    pending.settle(reply, failure);
    performed(
      pending.call,
      entry.member.row.id,
      reply === null
        ? failure?.code === "timeout"
          ? "timeout"
          : "refused"
        : reply.kind === "result"
          ? "performed"
          : "failed",
    );
    advance(entry);
  };

  return {
    rows,
    join(member) {
      const entry: Entry = { member, waiting: [], current: null, listening: false, seq: 0 };
      entries.set(member.row.id, entry);
      announce();

      return {
        listen(listening) {
          entry.listening = listening;
          deliver(entry);
        },
        leave() {
          if (entries.get(member.row.id) !== entry) return;
          entries.delete(member.row.id);
          const gone = new SdkError("unavailable", "The client left before it answered.");

          for (const pending of [entry.current, ...entry.waiting.splice(0)])
            if (pending !== null) finish(entry, pending, null, gone);
          announce();
        },
      };
    },
    observe(listener) {
      observers.add(listener);

      return () => {
        observers.delete(listener);
      };
    },
    perform(requester, request) {
      const entry = entries.get(request.client);

      if (entry === undefined)
        return Promise.reject(new SdkError("unknown", `No client ${request.client} is connected.`));
      const call = crypto.randomUUID();

      if (!entry.member.row.actions.some((action) => action.name === request.action)) {
        performed(call, request.client, "refused");

        return Promise.reject(
          new SdkError(
            "not_supported",
            `Client ${request.client} declared no action ${request.action}.`,
          ),
        );
      }

      if (entry.waiting.length >= MAX_WAITING) {
        performed(call, request.client, "refused");

        return Promise.reject(
          new SdkError(
            "unavailable",
            `Client ${request.client} has ${MAX_WAITING} requests waiting.`,
          ),
        );
      }

      return new Promise<Json>((resolve, reject) => {
        entry.waiting.push({
          call,
          requester,
          action: request.action,
          input: request.input,
          timeoutMs: Math.min(request.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS),
          timer: undefined,
          delivered: false,
          settle(reply, failure) {
            if (reply === null) reject(failure);
            else if (reply.kind === "result") resolve(reply.result);
            else reject(new SdkError(reply.code, reply.message));
          },
        });
        advance(entry);
      });
    },
    reply(from, call, reply) {
      const entry = entries.get(from);
      const pending = entry?.current;

      if (
        entry === undefined ||
        pending === null ||
        pending === undefined ||
        pending.call !== call ||
        !pending.delivered
      )
        throw new SdkError("unknown", `No call ${call} is waiting for this client's answer.`);
      finish(entry, pending, reply, null);
    },
  };
}

export function performOffered(
  server: ServerHost,
  request: { readonly action: string; readonly input: Json; readonly timeoutMs: number },
): Promise<Json> {
  const clients = sharedClients(server);
  const target = clients
    .rows()
    .find((row) => row.actions.some((action) => action.name === request.action));

  if (target === undefined)
    return Promise.reject(
      new SdkError("not_supported", `No connected client offers ${request.action}.`),
    );

  return clients.perform(HOST_REQUESTER, { ...request, client: target.id });
}
