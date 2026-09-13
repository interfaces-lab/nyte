/** Merge lanes chronologically without re-sorting a lane's chosen delivery order. */
export function mergeQueuedLanes<T>(
  items: readonly T[],
  options: { readonly lane: (item: T) => string; readonly compare: (left: T, right: T) => number },
): T[] {
  // Keep this projection free of store and Node imports so native clients can fold queues.
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const name = options.lane(item);
    const lane = groups.get(name);
    if (lane === undefined) groups.set(name, [item]);
    else lane.push(item);
  }
  const lanes = [...groups.values()].map((queue) => ({ queue, index: 0 }));
  const ordered: T[] = [];
  for (let count = 0; count < items.length; count += 1) {
    let best: { readonly lane: (typeof lanes)[number]; readonly item: T } | undefined;
    for (const lane of lanes) {
      const item = lane.queue[lane.index];
      if (item !== undefined && (best === undefined || options.compare(item, best.item) < 0)) {
        best = { lane, item };
      }
    }
    if (best === undefined) break;
    ordered.push(best.item);
    best.lane.index += 1;
  }
  return ordered;
}
