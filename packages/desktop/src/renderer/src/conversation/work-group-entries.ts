export interface WorkGroupEntries<Entry> {
  readonly count: number;
  readonly at: (index: number) => Entry | undefined;
  readonly keyAt: (index: number) => string | number;
}

/** Join a durable prefix and live suffix without copying the prefix on streamed frames. */
export function createWorkGroupEntries<Entry extends { readonly key: string }>() {
  let previous:
    | {
        readonly settled: readonly Entry[];
        readonly liveKeys: readonly string[];
        readonly keyAt: WorkGroupEntries<Entry>["keyAt"];
      }
    | undefined;

  return (settled: readonly Entry[], live: readonly Entry[]): WorkGroupEntries<Entry> => {
    if (
      previous === undefined ||
      previous.settled !== settled ||
      previous.liveKeys.length !== live.length ||
      !previous.liveKeys.every((key, index) => key === live[index]?.key)
    ) {
      const liveKeys = live.map((entry) => entry.key);
      previous = {
        settled,
        liveKeys,
        keyAt: (index) => settled[index]?.key ?? liveKeys[index - settled.length] ?? index,
      };
    }

    return {
      count: settled.length + live.length,
      at: (index) => (index < settled.length ? settled[index] : live[index - settled.length]),
      // Text changes do not invalidate the virtualizer's full measurement index.
      keyAt: previous.keyAt,
    };
  };
}
