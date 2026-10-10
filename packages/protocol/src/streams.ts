/** Returns a source with each value mapped; `return()` reaches the source at once, even while a pull waits, so a cancelled response stops a live stream. */
export function mapped<T, U>(source: AsyncIterable<T>, map: (value: T) => U): AsyncIterable<U> {
  return {
    [Symbol.asyncIterator]() {
      const iterator = source[Symbol.asyncIterator]();

      return {
        async next() {
          const next = await iterator.next();

          return next.done === true
            ? { done: true, value: undefined }
            : { done: false, value: map(next.value) };
        },
        async return() {
          await iterator.return?.();

          return { done: true, value: undefined };
        },
      };
    },
  };
}

/** Returns a source that ends when the signal aborts: the abort returns the source. */
export function abortable<T>(source: AsyncIterable<T>, signal: AbortSignal): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      const iterator = source[Symbol.asyncIterator]();
      const close = (): void => void iterator.return?.();

      signal.addEventListener("abort", close, { once: true });

      return {
        async next() {
          if (signal.aborted) return { done: true, value: undefined };
          const next = await iterator.next();

          if (next.done === true) signal.removeEventListener("abort", close);

          return next;
        },
        async return() {
          signal.removeEventListener("abort", close);
          await iterator.return?.();

          return { done: true, value: undefined };
        },
      };
    },
  };
}
