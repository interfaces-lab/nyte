/** Merge deliveries chronologically without re-sorting either delivery's chosen order. */
export function mergeByDelivery<T>(
  items: readonly T[],
  options: {
    readonly delivery: (item: T) => string;
    readonly compare: (left: T, right: T) => number;
  },
): T[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const name = options.delivery(item);
    const delivery = groups.get(name);
    if (delivery === undefined) groups.set(name, [item]);
    else delivery.push(item);
  }
  const deliveries = [...groups.values()].map((queue) => ({ queue, index: 0 }));
  const ordered: T[] = [];
  for (let count = 0; count < items.length; count += 1) {
    let best: { readonly delivery: (typeof deliveries)[number]; readonly item: T } | undefined;
    for (const delivery of deliveries) {
      const item = delivery.queue[delivery.index];
      if (item !== undefined && (best === undefined || options.compare(item, best.item) < 0)) {
        best = { delivery, item };
      }
    }
    if (best === undefined) break;
    ordered.push(best.item);
    best.delivery.index += 1;
  }
  return ordered;
}
