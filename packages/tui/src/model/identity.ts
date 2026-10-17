export function keepEqual<T>(
  previous: readonly T[] | undefined,
  next: readonly T[],
  same: (left: T, right: T) => boolean,
): readonly T[] {
  if (previous === undefined) return next;
  let changed = previous.length !== next.length;

  const merged = next.map((item, index) => {
    const before = previous[index];

    if (before !== undefined && same(before, item)) return before;
    changed = true;

    return item;
  });

  return changed ? merged : previous;
}
