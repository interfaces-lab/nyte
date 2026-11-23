import { SdkError } from "@nyte-ai/schema";
import type { ByteReader, Json, OutputFrame, RequestOptions } from "@nyte-ai/schema";
import { closable, dev } from "@nyte-ai/core/client";
import { decodeOutput, encodeInput, linkLost } from "@nyte-ai/protocol";
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
import { untilOpen } from "../live/link.ts";
import type { LinkCell } from "../live/link.ts";
import { retryDelay } from "../live/store.ts";

type RetryName = {
  [N in OperationName]: Declarations[N] extends { readonly wait: true }
    ? N
    : Declarations[N] extends { readonly recovery: "replay" }
      ? OperationInput<N> extends { readonly id: string }
        ? N
        : never
      : never;
}[OperationName];

export interface Rows {
  readonly link: LinkCell;
  operations(): string | null;
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
    body: Uint8Array,
  ): Promise<OperationOutput<N>>;
  bytes<N extends ByteName>(
    name: N,
    input: OperationInput<N>,
    options?: RequestOptions,
  ): Promise<ByteReader>;
  frames<N extends FrameName>(name: N, input: OperationInput<N>): AsyncIterable<OperationOutput<N>>;
  watch<N extends FrameName>(
    name: N,
    input: OperationInput<N>,
    opened?: AsyncIterator<Json>,
  ): AsyncIterable<OperationOutput<N>>;
  output(input: OperationInput<"job.output">): AsyncIterable<OutputFrame>;
}

const DONE = { done: true, value: undefined } as const;

export function createRows(transport: Transport, link: LinkCell): Rows {
  const request = async <T>(
    send: (signal: AbortSignal) => Promise<T>,
    signal: AbortSignal | undefined,
  ): Promise<T> => {
    link.closed.throwIfAborted();
    const state = link.snapshot();

    if (state.kind === "refused") throw state.error;

    try {
      return await send(
        signal === undefined ? link.closed : AbortSignal.any([link.closed, signal]),
      );
    } catch (error) {
      link.closed.throwIfAborted();
      refuseFor(transport, link, error);

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
    operations: () => transport.operations(),
    call,
    async wait(name, input, options) {
      for (let attempts = 1; ; attempts += 1) {
        try {
          return await call(name, input, options);
        } catch (error) {
          if (!linkLost(error) || link.closed.aborted || options?.signal?.aborted === true) {
            throw error;
          }
          dev("sdk", "wait retrying", { name, attempts });
          await untilOpen(
            link,
            retryDelay(attempts - 1),
            options?.signal === undefined
              ? link.closed
              : AbortSignal.any([link.closed, options.signal]),
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
        link.closed,
      ),
    watch: (name, input, opened) =>
      resumable(transport, link, name, encodeInput(name, input), opened),
    output: (input) =>
      through(
        transport.output(encodeInput("job.output", input)),
        (frame) => (frame.kind === "bytes" ? { value: frame } : decoded("job.output", frame)),
        link.closed,
      ),
  };
}

function resumable<N extends OperationName>(
  transport: Transport,
  link: LinkCell,
  name: N,
  input: Json,
  opened: AsyncIterator<Json> | undefined,
): AsyncIterable<OperationOutput<N>> {
  return closable<OperationOutput<N>>(() => {
    const stop = new AbortController();
    const signal = AbortSignal.any([stop.signal, link.closed]);
    let frames: AsyncIterator<Json> | null = opened ?? null;
    let attempts = 0;
    let reopened = false;

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
            if (refuseFor(transport, link, error)) return DONE;

            if (!linkLost(error)) throw error;
          }

          if (next.done !== true) {
            if (attempts > 0) dev("sdk", "watch resumed", { name, attempts });

            attempts = 0;
            const value = decoded(name, next.value);

            if (value !== null) {
              reopened = false;

              return { done: false, value: value.value };
            }

            if (reopened) {
              throw new SdkError(
                "invalid",
                `The host sends ${name} frames this client cannot read.`,
              );
            }
            reopened = true;
            frames = null;
            void current.return?.();
            dev("sdk", "watch reopened", { name });

            continue;
          }

          frames = null;

          if (signal.aborted) return DONE;
          attempts += 1;
          dev("sdk", "watch reconnecting", { name, attempts });
          await untilOpen(link, retryDelay(attempts - 1), signal);
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

            const next = await iterator.next().catch((cause: unknown) => {
              signal.removeEventListener("abort", stop);

              throw cause;
            });

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

function refuseFor(transport: Transport, link: LinkCell, error: unknown): boolean {
  if (!(error instanceof SdkError)) return false;
  const pinned = transport.host();

  if (
    error.code === "stale" &&
    pinned !== null &&
    error.hostId !== null &&
    error.hostId !== pinned
  ) {
    link.refuse({ reason: "other-host", error });

    return true;
  }

  if (error.code !== "unauthenticated") return false;
  link.refuse({ reason: "auth", error });

  return true;
}
