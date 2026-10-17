const MAX_BYTES = 8 * 1024 * 1024;

const MAX_CHUNKS = 4096;

export function streamBuffer(cancel: () => void) {
  let chunks: Uint8Array[] = [];
  let head = 0;
  let bytes = 0;
  let ending: { readonly error?: Error } | undefined;
  let wake: (() => void) | undefined;
  const writers = new Set<() => void>();

  const writable = (): void => {
    for (const resolve of writers) resolve();
  };

  const notify = (): void => {
    const resolve = wake;
    wake = undefined;
    resolve?.();
  };

  const clear = (): void => {
    chunks = [];
    head = 0;
    bytes = 0;
    writable();
  };

  const push = (chunk: Uint8Array): boolean => {
    if (ending !== undefined) return false;

    if (bytes + chunk.byteLength > MAX_BYTES || chunks.length - head >= MAX_CHUNKS) return false;
    chunks.push(chunk);
    bytes += chunk.byteLength;
    notify();

    return true;
  };

  return {
    body: new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          for (;;) {
            if (ending?.error !== undefined) {
              controller.error(ending.error);

              return;
            }

            const chunk = chunks[head];

            if (chunk !== undefined) {
              head += 1;
              bytes -= chunk.byteLength;
              writable();

              if (head === chunks.length) clear();
              else if (head >= 256) {
                chunks = chunks.slice(head);
                head = 0;
              }

              controller.enqueue(chunk);

              return;
            }

            if (ending !== undefined) {
              controller.close();

              return;
            }

            await new Promise<void>((resolve) => {
              wake = resolve;
            });
          }
        },
        cancel() {
          ending ??= {};
          clear();
          notify();
          cancel();
        },
      },
      { highWaterMark: 0 },
    ),
    push,
    async write(chunk: Uint8Array, signal: AbortSignal): Promise<void> {
      for (let start = 0; start < chunk.byteLength; start += MAX_BYTES) {
        const part = chunk.subarray(start, start + MAX_BYTES);

        for (;;) {
          if (ending !== undefined || signal.aborted) return;

          if (push(part)) break;
          await new Promise<void>((resolve) => {
            const ready = (): void => {
              writers.delete(ready);
              signal.removeEventListener("abort", ready);
              resolve();
            };

            writers.add(ready);
            signal.addEventListener("abort", ready, { once: true });
          });
        }
      }
    },
    end(final?: Uint8Array) {
      if (final !== undefined) {
        clear();
        chunks.push(final);
        bytes = final.byteLength;
      }

      ending ??= {};
      notify();
      writable();
    },
    fail(error: Error) {
      ending = { error };
      clear();
      notify();
    },
  };
}
