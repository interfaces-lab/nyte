import { SdkError } from "@nyte-ai/schema";
import type {
  ByteReader,
  Disposer,
  HostView,
  Json,
  OutputFrame,
  RequestOptions,
} from "@nyte-ai/schema";
import { closable, dev } from "@nyte-ai/core";
import { decodeOutput, encodeInput } from "@nyte-ai/protocol";
import type {
  ByteName,
  CallName,
  Declarations,
  FrameName,
  OperationInput,
  OperationName,
  OperationOutput,
  Transport,
} from "@nyte-ai/protocol";

export type LinkState = HostView["link"];

type RetryName = {
  [N in OperationName]: Declarations[N] extends
    | { readonly wait: true }
    | { readonly recovery: "replay" }
    ? N
    : never;
}[OperationName];

export interface Link {
  current(): LinkState;
  lost(): void;
  restored(): void;
  close(reason: "client" | "revoked" | "host-gone"): void;
  subscribe(listener: (state: LinkState) => void): Disposer;
  readonly signal: AbortSignal;
}

export interface Rows {
  readonly link: Link;
  call<N extends CallName>(
    name: N,
    input: OperationInput<N>,
    options?: RequestOptions,
  ): Promise<OperationOutput<N>>;
  wait<N extends RetryName>(
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

export function createRows(transport: Transport, link: Link): Rows {
  const request = async <T>(
    send: (signal: AbortSignal) => Promise<T>,
    signal: AbortSignal | undefined,
  ): Promise<T> => {
    link.signal.throwIfAborted();

    try {
      const answer = await send(
        signal === undefined ? link.signal : AbortSignal.any([link.signal, signal]),
      );

      link.restored();

      return answer;
    } catch (error) {
      if (hostGone(transport, error)) link.close("host-gone");

      link.signal.throwIfAborted();

      if (linkLost(error)) link.lost();

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
          if (!linkLost(error) || link.signal.aborted || options?.signal?.aborted === true)
            throw error;
          dev("sdk", "wait retrying", { name, attempts });
          await backoff(
            link,
            retryDelay(attempts),
            options?.signal === undefined
              ? link.signal
              : AbortSignal.any([link.signal, options.signal]),
          );
          options?.signal?.throwIfAborted();
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
        transport.frames(name, encodeInput(name, input)),
        (frame) => decoded(name, frame),
        link.signal,
      ),
    watch: (name, input) =>
      through(
        resumable(transport, link, name, encodeInput(name, input)),
        (frame) => decoded(name, frame),
        link.signal,
      ),
    output: (input) =>
      through(
        transport.output(encodeInput("job.output", input)),
        (frame) => (frame.kind === "bytes" ? { value: frame } : decoded("job.output", frame)),
        link.signal,
      ),
  };
}

/** Returns a watch's frames across link losses: each loss reports the link and reopens the watch after a backoff, and its first frame restores the link; the host answers a reopened watch from its current state. */
function resumable(
  transport: Transport,
  link: Link,
  name: OperationName,
  input: Json,
): AsyncIterable<Json> {
  return closable<Json>(() => {
    const stop = new AbortController();
    const signal = AbortSignal.any([stop.signal, link.signal]);
    let frames: AsyncIterator<Json> | null = null;
    let attempts = 0;

    const release = (): void => {
      void frames?.return?.();
    };

    signal.addEventListener("abort", release, { once: true });

    return {
      async pull() {
        for (;;) {
          if (signal.aborted) return DONE;
          const current = frames ?? transport.frames(name, input)[Symbol.asyncIterator]();
          frames = current;
          let next: IteratorResult<Json> = DONE;

          try {
            next = await current.next();
          } catch (error) {
            if (hostGone(transport, error)) {
              link.close("host-gone");

              return DONE;
            }

            if (error instanceof SdkError && error.code === "unauthenticated") {
              link.close("revoked");

              return DONE;
            }

            if (!linkLost(error)) throw error;
          }

          if (next.done !== true) {
            if (attempts > 0) {
              dev("sdk", "watch resumed", { name, attempts });
              link.restored();
            }

            attempts = 0;

            return next;
          }

          frames = null;

          if (signal.aborted) return DONE;
          attempts += 1;
          dev("sdk", "watch reconnecting", { name, attempts });
          link.lost();
          await backoff(link, retryDelay(attempts), signal);
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

function hostGone(transport: Transport, error: unknown): boolean {
  const pinned = transport.host();

  return (
    error instanceof SdkError &&
    error.code === "stale" &&
    pinned !== null &&
    error.hostId !== null &&
    error.hostId !== pinned
  );
}

function linkLost(error: unknown): error is SdkError {
  return error instanceof SdkError && error.code === "unavailable";
}

export function retryDelay(attempts: number): number {
  return attempts <= 1
    ? FIRST_DELAY_MS
    : Math.min(BASE_DELAY_MS * 2 ** (attempts - 2), MAX_DELAY_MS);
}

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
