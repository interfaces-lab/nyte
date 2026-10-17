import type { ByteReader } from "@nyte-ai/schema";

/** A byte reader that yields one chunk and then waits until it is closed, counting its closes. */
export function endless(): ByteReader & { closes(): number } {
  let closes = 0;
  const closed = Promise.withResolvers<void>();

  return {
    size: null,
    mime: null,
    async *chunks() {
      yield Uint8Array.of(7);
      await closed.promise;
    },
    close: async () => {
      closes += 1;
      closed.resolve();
    },
    closes: () => closes,
    [Symbol.asyncDispose]: async () => undefined,
  };
}
