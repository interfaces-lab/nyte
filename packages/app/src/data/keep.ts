export function keepList<T>(previous: readonly T[], next: readonly T[]): readonly T[] {
  return previous.length === next.length && next.every((item, index) => item === previous[index])
    ? previous
    : next;
}

export function keepMap<K, V>(
  previous: ReadonlyMap<K, V>,
  next: ReadonlyMap<K, V>,
): ReadonlyMap<K, V> {
  return previous.size === next.size &&
    [...next].every(([key, value]) => previous.has(key) && previous.get(key) === value)
    ? previous
    : next;
}

export function keepSet<T>(previous: ReadonlySet<T>, next: ReadonlySet<T>): ReadonlySet<T> {
  return previous.size === next.size && [...next].every((item) => previous.has(item))
    ? previous
    : next;
}

export function reconcile<K, V>(
  held: Map<K, V>,
  wanted: ReadonlySet<K>,
  open: (key: K) => V,
  close: (value: V) => void,
): void {
  for (const [key, value] of held)
    if (!wanted.has(key)) {
      close(value);
      held.delete(key);
    }

  for (const key of wanted) if (!held.has(key)) held.set(key, open(key));
}
