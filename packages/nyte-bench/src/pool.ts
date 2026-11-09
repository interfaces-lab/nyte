/** Runs `work` over `items` with at most `size` in flight, returning results in completion order. */
export async function pool<T, R>(
  items: readonly T[],
  size: number,
  work: (item: T) => Promise<R>,
): Promise<readonly R[]> {
  const done: R[] = [];
  const queue = [...items];

  const worker = async (): Promise<void> => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift())
      done.push(await work(item));
  };

  await Promise.all(Array.from({ length: Math.max(1, size) }, worker));

  return done;
}
