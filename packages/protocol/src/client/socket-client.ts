import {
  API_MIN_REVISION,
  API_REVISION,
  isJsonObject,
  SdkError,
  SOCKET_LIMITS,
} from "@nyte-ai/schema";
import type {
  ClientInfo,
  EventFrame,
  Json,
  JsonSchema,
  TextFrame,
  WelcomeFrame,
} from "@nyte-ai/schema";
import { errors, events, fragments, results, texts, welcomes } from "../wire/frame-checks.ts";
import { readJson } from "../wire/json.ts";
import { decodeError } from "../wire/wire.ts";

export interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void;
  addEventListener(
    type: "close",
    listener: (event: { readonly code: number; readonly reason: string }) => void,
  ): void;
  addEventListener(type: "error", listener: () => void): void;
}

export type SocketClosed = { readonly code: number; readonly reason: string };

export type SocketEvent = EventFrame & JsonSchema;

/**
 * One client's socket to its host. It counts itself lost when the host stops answering: no WebSocket API shows the host's pings to the page, so it asks the host something after a quiet spell, and closes itself when nothing comes back. Losing it fails every pending call with the `unavailable` a dropped socket fails them with, and settles `closed` at once, without waiting for a close handshake a dead link never finishes.
 */
export interface HostSocket {
  readonly welcome: Promise<WelcomeFrame>;
  readonly closed: Promise<SocketClosed>;
  call(op: string, input: Json): Promise<Json>;
  onEvent(listener: (event: SocketEvent) => void): () => void;
  onText(listener: (frame: TextFrame) => void): () => void;
  /** Asks the host something now and resolves when anything arrives; rejects, and loses the socket, when nothing does within `ASKED_PROBE_MS`. */
  probe(): Promise<void>;
  close(): void;
}

type Waiting = {
  readonly resolve: (output: Json) => void;
  readonly reject: (error: SdkError) => void;
};

type Probe = { readonly deadline: number; readonly answered: PromiseWithResolvers<void> };

const OPEN_MS = 10_000;

const IDLE_PROBE_MS = 30_000;

const OWED_PROBE_MS = 5_000;

const PROBE_MS = 10_000;

const ASKED_PROBE_MS = 2_000;

const PROBE_FRAME = { c: "e", type: "call", op: "events.unsubscribe", input: { scopes: [] } };

const LOST_REASON = "The host stopped answering.";

export async function openHostSocket(input: {
  readonly socket: SocketLike;
  readonly client: ClientInfo;
  readonly apiMinRevision?: number;
}): Promise<HostSocket> {
  const socket = input.socket;
  const waiting = new Map<string, Waiting>();
  const eventListeners = new Set<(event: SocketEvent) => void>();
  const textListeners = new Set<(frame: TextFrame) => void>();
  const greeted = Promise.withResolvers<WelcomeFrame>();
  const ended = Promise.withResolvers<SocketClosed>();
  const pieces: string[] = [];
  let held = 0;
  let calls = 0;
  let probes = 0;
  let lost: SdkError | null = null;
  let welcomed = false;
  let heard = Date.now();
  let owedSince = heard;
  let probe: Probe | null = null;
  let watch: ReturnType<typeof setTimeout> | undefined;

  greeted.promise.catch(() => undefined);

  const finish = (closed: SocketClosed): void => {
    if (lost !== null) return;
    clearTimeout(watch);

    lost = new SdkError(
      "unavailable",
      closed.reason === "" ? `The host closed the socket (${closed.code}).` : closed.reason,
    );

    greeted.reject(lost);

    for (const entry of waiting.values()) entry.reject(lost);
    waiting.clear();
    ended.resolve(closed);
    probe?.answered.reject(lost);
    probe = null;
  };

  const watchAt = (at: number): void => {
    clearTimeout(watch);
    watch = setTimeout(check, Math.max(0, at - Date.now()));
  };

  const ask = (deadline: number): Promise<void> => {
    if (probe !== null) {
      probe = { ...probe, deadline: Math.min(probe.deadline, deadline) };
      watchAt(probe.deadline);

      return probe.answered.promise;
    }

    const answered = Promise.withResolvers<void>();
    answered.promise.catch(() => undefined);
    probe = { deadline, answered };
    probes += 1;
    socket.send(JSON.stringify({ ...PROBE_FRAME, id: `probe-${String(probes)}` }));
    watchAt(deadline);

    return answered.promise;
  };

  const check = (): void => {
    if (lost !== null) return;
    const now = Date.now();

    if (probe !== null) {
      if (now < probe.deadline) {
        watchAt(probe.deadline);

        return;
      }

      finish({ code: 1006, reason: LOST_REASON });
      socket.close(1000, LOST_REASON);

      return;
    }

    const owes = waiting.size > 0 || !welcomed;
    const quietSince = owes ? Math.max(heard, owedSince) : heard;
    const quiet = owes ? OWED_PROBE_MS : IDLE_PROBE_MS;

    if (now - quietSince < quiet) {
      watchAt(quietSince + quiet);

      return;
    }

    void ask(now + PROBE_MS);
  };

  const read = (value: Json | undefined): void => {
    if (welcomes.Check(value)) {
      welcomed = true;
      greeted.resolve(value);
    } else if (results.Check(value)) settle(value.id, value.output, null);
    else if (errors.Check(value)) settle(value.id, null, decodeError(value.error));
    else if (isJsonObject(value) && events.Check(value))
      for (const listener of eventListeners) listener(value);
    else if (texts.Check(value)) for (const listener of textListeners) listener(value);
  };

  socket.addEventListener("message", (message) => {
    heard = Date.now();
    probe?.answered.resolve();
    probe = null;
    const value = typeof message.data === "string" ? readJson(message.data) : undefined;

    if (!fragments.Check(value)) {
      read(value);

      return;
    }

    held += value.text.length;

    if (held > SOCKET_LIMITS.backlogBytes) {
      pieces.length = 0;
      socket.close(1000, "Fragments passed the backlog limit.");

      return;
    }

    pieces.push(value.text);

    if (!value.last) return;
    const joined = readJson(pieces.join(""));
    pieces.length = 0;
    held = 0;

    if (joined === undefined) {
      socket.close(1000, "Fragments joined to no frame.");

      return;
    }

    read(joined);
  });

  socket.addEventListener("close", (event) => finish({ code: event.code, reason: event.reason }));

  const settle = (id: string, output: Json, failure: SdkError | null): void => {
    const entry = waiting.get(id);

    if (entry === undefined) return;
    waiting.delete(id);

    if (failure === null) entry.resolve(output);
    else entry.reject(failure);
  };

  await new Promise<void>((opened, failed) => {
    const opening = setTimeout(() => {
      failed(new SdkError("unavailable", "The host's socket didn't open in time."));
      socket.close();
    }, OPEN_MS);

    socket.addEventListener("open", () => {
      clearTimeout(opening);
      opened();
    });
    socket.addEventListener("error", () => {
      clearTimeout(opening);
      failed(new SdkError("unavailable", "Couldn't open the host's socket."));
    });
  });

  socket.send(
    JSON.stringify({
      c: "e",
      type: "hello",
      api_min_revision: input.apiMinRevision ?? API_MIN_REVISION,
      api_revision: API_REVISION,
      client: input.client,
    }),
  );
  heard = Date.now();
  owedSince = heard;
  watchAt(heard + OWED_PROBE_MS);

  return {
    welcome: greeted.promise,
    closed: ended.promise,
    call(op, value) {
      if (lost !== null) return Promise.reject(lost);
      calls += 1;
      const id = String(calls);

      if (waiting.size === 0) owedSince = Date.now();

      return new Promise<Json>((resolve, reject) => {
        waiting.set(id, { resolve, reject });
        socket.send(JSON.stringify({ c: "e", type: "call", id, op, input: value }));

        if (probe === null) watchAt(Math.max(heard, owedSince) + OWED_PROBE_MS);
      });
    },
    onEvent(listener) {
      eventListeners.add(listener);

      return () => {
        eventListeners.delete(listener);
      };
    },
    onText(listener) {
      textListeners.add(listener);

      return () => {
        textListeners.delete(listener);
      };
    },
    probe() {
      if (lost !== null) return Promise.reject(lost);

      return ask(Date.now() + ASKED_PROBE_MS);
    },
    close() {
      finish({ code: 1000, reason: "done" });
      socket.close(1000, "done");
    },
  };
}
