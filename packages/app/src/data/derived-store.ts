/** `read` returns the same value until the input changes. */
export interface StoreSource<T> {
  readonly read: () => T;
  readonly subscribe: (notice: () => void) => () => void;
}

export interface DerivedStore<T> {
  readonly getSnapshot: () => T;
  readonly subscribe: (notice: () => void) => () => void;
}

/** `derive` gets what it derived last so unchanged parts can keep their identity. */
export function derivedStore<S extends Readonly<Record<string, StoreSource<unknown>>>, T>(
  sources: S,
  derive: (sources: S, previous: T) => T,
  initial: T,
): DerivedStore<T> {
  const list = Object.values(sources);
  const listeners = new Set<() => void>();
  let read: readonly unknown[] | undefined;
  let value = initial;
  let leave: readonly (() => void)[] | undefined;

  const notify = (): void => {
    for (const notice of listeners) notice();
  };

  return {
    getSnapshot() {
      const next = list.map((source) => source.read());
      const last = read;

      if (last !== undefined && next.every((item, index) => item === last[index])) return value;
      read = next;
      value = derive(sources, value);

      return value;
    },
    subscribe(notice) {
      listeners.add(notice);
      leave ??= list.map((source) => source.subscribe(notify));

      return () => {
        listeners.delete(notice);

        if (listeners.size > 0) return;

        for (const unsubscribe of leave ?? []) unsubscribe();
        leave = undefined;
      };
    },
  };
}
