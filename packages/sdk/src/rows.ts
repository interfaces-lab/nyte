import type {
  ByteReader,
  Disposer,
  HostView,
  Json,
  OutputFrame,
  RequestOptions,
} from "@nyte-ai/schema";
import { SdkError, closable, dev } from "@nyte-ai/core";
import { decodeOutput, encodeInput } from "@nyte-ai/protocol";
import type {
  ByteName,
  CallName,
  FrameName,
  OperationInput,
  OperationName,
  OperationOutput,
  SseFrame,
  Transport,
} from "@nyte-ai/protocol";

/** Returns the link state a connection reports on `HostView.link`. */
export type LinkState = HostView["link"];

/**
 * Holds one connection's link state and the signal its close aborts.
 *
 * A request or stream that loses the link calls `lost()` for each failed
 * attempt, and one that gets through calls `restored()`, which wakes every
 * waiting retry. `close` is terminal and aborts `signal`, which ends every
 * request and stream bound to the link.
 */
export interface Link {
  current(): LinkState;
  lost(): void;
  restored(): void;
  close(reason: "client" | "revoked" | "host-gone"): void;
  subscribe(listener: (state: LinkState) => void): Disposer;
  readonly signal: AbortSignal;
}

/**
 * Returns every row of the declaration table bound to a transport, one
 * method per wire shape, so a new row needs no client change.
 *
 * `call` answers once, `upload` sends bytes as the body, `bytes` returns a
 * reader, `frames` yields a stream row's frames once, `watch` yields a watch
 * row's frames across link loss (resuming after the last event id), and
 * `output` yields `job.output`. `wait` is `call` retried across link loss,
 * for the long waits (`settled`, `landed`, `answer`). Any 401 closes the
 * link `revoked`. Every frame is decoded leniently; a frame that still fails
 * its schema is skipped with a `dev` line (§47m).
 */
export interface Rows {
  readonly link: Link;
  call<N extends CallName>(
    name: N,
    input: OperationInput<N>,
    options?: RequestOptions,
  ): Promise<OperationOutput<N>>;
  wait<N extends CallName>(
    name: N,
    input: OperationInput<N>,
    options?: RequestOptions,
  ): Promise<OperationOutput<N>>;
  upload<N extends CallName>(
    name: N,
    input: OperationInput<N>,
    body: Uint8Array | ReadableStream<Uint8Array>,
  ): Promise<OperationOutput<N>>;
  bytes<N extends ByteName>(
    name: N,
    input: OperationInput<N>,
    options?: RequestOptions,
  ): Promise<ByteReader>;
  frames<N extends FrameName>(name: N, input: OperationInput<N>): AsyncIterable<OperationOutput<N>>;
  watch<N extends FrameName>(name: N, input: OperationInput<N>): AsyncIterable<OperationOutput<N>>;
  output(input: OperationInput<"job.output">): AsyncIterable<OutputFrame>;
}

const DONE = { done: true, value: undefined } as const;

const FIRST_DELAY_MS = 50;

const BASE_DELAY_MS = 250;

const MAX_DELAY_MS = 10_000;

/** Returns a link that starts connected. */
export function createLink(): Link {
  let state: LinkState = { kind: "connected" };
  const listeners = new Set<(state: LinkState) => void>();
  const controller = new AbortController();

  const publish = (next: LinkState): void => {
    state = next;

    for (const listener of listeners) listener(next);
  };

  return {
    current: () => state,
    lost() {
      if (state.kind === "closed") return;
      publish(
        state.kind === "reconnecting"
          ? { ...state, attempts: state.attempts + 1 }
          : { kind: "reconnecting", since: Date.now(), attempts: 1 },
      );
    },
    restored() {
      if (state.kind === "reconnecting") publish({ kind: "connected" });
    },
    close(reason) {
      if (state.kind === "closed") return;
      dev("sdk", "link closed", { reason });
      publish({ kind: "closed", reason });
      controller.abort(new SdkError("unavailable", "The connection is closed."));
    },
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    signal: controller.signal,
  };
}

/** Returns the table's rows over `transport`, every request and stream ended by the link's close. */
export function createRows(transport: Transport, link: Link): Rows {
  const request = async <T>(
    send: (signal: AbortSignal) => Promise<T>,
    signal: AbortSignal | undefined,
  ): Promise<T> => {
    if (link.signal.aborted) throw closed(link);

    try {
      const answer = await send(
        signal === undefined ? link.signal : AbortSignal.any([link.signal, signal]),
      );

      link.restored();

      return answer;
    } catch (error) {
      if (link.signal.aborted) throw closed(link);

      if (isLinkLoss(error)) link.lost();

      if (error instanceof SdkError && error.code === "unauthenticated") link.close("revoked");

      throw error;
    }
  };

  const call: Rows["call"] = async (name, input, options) =>
    decodeOutput(
      name,
      await request(
        (signal) => transport.invoke(name, encodeInput(name, input), { signal }),
        options?.signal,
      ),
    );

  return {
    link,
    call,
    async wait(name, input, options) {
      for (let attempts = 1; ; attempts += 1) {
        try {
          return await call(name, input, options);
        } catch (error) {
          if (!isLinkLoss(error) || link.signal.aborted || options?.signal?.aborted === true)
            throw error;
          dev("sdk", "wait retrying", { name, attempts });
          await backoff(link, delayOf(attempts), link.signal);
        }
      }
    },
    async upload(name, input, body) {
      return decodeOutput(
        name,
        await request(
          (signal) => transport.upload(name, encodeInput(name, input), body, { signal }),
          undefined,
        ),
      );
    },
    bytes: (name, input, options) =>
      request(
        (signal) => transport.bytes(name, encodeInput(name, input), { signal }),
        options?.signal,
      ),
    frames: (name, input) =>
      through(
        transport.stream(name, encodeInput(name, input)),
        (frame) => (frame instanceof Uint8Array ? null : decoded(name, frame)),
        link.signal,
      ),
    watch: (name, input) =>
      through(
        resumable(transport, link, name, encodeInput(name, input)),
        (frame) => decoded(name, frame.data),
        link.signal,
      ),
    output: (input) =>
      through(
        transport.stream("job.output", encodeInput("job.output", input)),
        (frame) =>
          frame instanceof Uint8Array
            ? { value: { kind: "bytes", data: frame } }
            : decoded("job.output", frame),
        link.signal,
      ),
  };
}

/**
 * Yields a watch row's frames across link loss: a clean end and a reset
 * socket are the same (§41j, §47c), so either reopens the request after
 * `delayOf`'s backoff, with `Last-Event-ID` set to the last id seen;
 * a stream body that errors mid-read is a reset socket.
 *
 * Each failed attempt marks the link reconnecting and the first frame after
 * one marks it connected. `unauthenticated` closes the link as revoked and
 * throws; any error other than `unavailable` throws. The link's close ends it.
 */
function resumable(
  transport: Transport,
  link: Link,
  name: OperationName,
  input: Json,
): AsyncIterable<SseFrame> {
  return closable<SseFrame>(() => {
    const stop = new AbortController();
    const signal = AbortSignal.any([stop.signal, link.signal]);
    let frames: AsyncIterator<SseFrame> | null = null;
    let last: string | undefined;
    let attempts = 0;

    const release = (): void => {
      void frames?.return?.();
    };

    signal.addEventListener("abort", release, { once: true });

    return {
      async pull() {
        for (;;) {
          if (signal.aborted) return DONE;
          const current = frames ?? transport.watch(name, input, last)[Symbol.asyncIterator]();
          frames = current;
          let next: IteratorResult<SseFrame> = DONE;

          try {
            next = await current.next();
          } catch (error) {
            if (error instanceof SdkError && error.code === "unauthenticated") {
              link.close("revoked");

              throw error;
            }

            if (!isLinkLoss(error) && !(error instanceof TypeError)) throw error;
          }

          if (next.done !== true) {
            if (attempts > 0) {
              dev("sdk", "watch resumed", { name, attempts, after: last ?? null });
              link.restored();
            }

            attempts = 0;

            if (next.value.id !== null) last = next.value.id;

            return next;
          }

          frames = null;

          if (signal.aborted) return DONE;
          attempts += 1;
          dev("sdk", "watch reconnecting", { name, attempts, after: last ?? null });
          link.lost();
          await backoff(link, delayOf(attempts), signal);
        }
      },
      close() {
        signal.removeEventListener("abort", release);
        stop.abort();
        release();
      },
    };
  });
}

/** Returns a source with each value mapped, a null mapping skipped; `return()` reaches the source at once and the signal's abort returns it. */
function through<T, U>(
  source: AsyncIterable<T>,
  map: (value: T) => { readonly value: U } | null,
  signal: AbortSignal,
): AsyncIterable<U> {
  return {
    [Symbol.asyncIterator]() {
      const iterator = source[Symbol.asyncIterator]();

      const stop = (): void => {
        void iterator.return?.();
      };

      signal.addEventListener("abort", stop, { once: true });

      return {
        async next(): Promise<IteratorResult<U>> {
          for (;;) {
            if (signal.aborted) return DONE;
            const next = await iterator.next();

            if (next.done === true) {
              signal.removeEventListener("abort", stop);

              return DONE;
            }

            const mapped = map(next.value);

            if (mapped !== null) return { done: false, value: mapped.value };
          }
        },
        async return(): Promise<IteratorResult<U>> {
          signal.removeEventListener("abort", stop);
          await iterator.return?.();

          return DONE;
        },
      };
    },
  };
}

/** Returns a frame decoded by its row's output schema, or null when it fails: a stream reader skips what it cannot read. */
function decoded<N extends OperationName>(
  name: N,
  data: Json,
): { readonly value: OperationOutput<N> } | null {
  try {
    return { value: decodeOutput(name, data) };
  } catch (error) {
    if (!(error instanceof SdkError) || error.code !== "invalid") throw error;
    dev("sdk", "frame skipped", { name, message: error.message });

    return null;
  }
}

/** Returns whether an error is the link failing rather than an answer: `unavailable`, which the transport also makes of a `TypeError` the `fetch` call itself throws (§47m). */
export function isLinkLoss(error: unknown): error is SdkError {
  return error instanceof SdkError && error.code === "unavailable";
}

/** Returns the retry delay after a number of failed attempts (§47d): 50 ms after the first, then 250 ms doubling, capped at 10 s. */
export function delayOf(attempts: number): number {
  return attempts <= 1
    ? FIRST_DELAY_MS
    : Math.min(BASE_DELAY_MS * 2 ** (attempts - 2), MAX_DELAY_MS);
}

/** Resolves after `ms`, or at once when the signal aborts or the link is restored, so every waiter retries as soon as one request gets through. */
export function backoff(link: Link, ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();

      return;
    }

    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      unsubscribe();
      resolve();
    };

    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });

    const unsubscribe = link.subscribe((state) => {
      if (state.kind === "connected") done();
    });
  });
}

function closed(link: Link): SdkError {
  const reason: unknown = link.signal.reason;

  return reason instanceof SdkError
    ? reason
    : new SdkError("unavailable", "The connection is closed.");
}
