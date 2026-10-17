/** Tasks that run one at a time, in the order they were queued. */
export interface Serial {
  /** Runs `task` once every task queued before it has settled. An earlier failure neither skips `task` nor rejects its result. */
  run<T>(task: () => Promise<T>): Promise<T>;
  /** Resolves, never rejects, once every task queued so far has settled. */
  settled(): Promise<void>;
  /** Whether a queued task has not settled yet. */
  readonly busy: boolean;
}

/** Tasks that run one at a time per key; tasks under different keys run independently. */
export interface KeyedSerial<K> {
  /** Runs `task` once every task queued under `key` before it has settled, as {@link Serial.run} does. */
  run<T>(key: K, task: () => Promise<T>): Promise<T>;
}

/** Returns an empty {@link Serial}. */
export function serial(): Serial {
  let tail: Promise<void> = Promise.resolve();
  let pending = 0;

  const settle = (): void => {
    pending -= 1;
  };

  return {
    run(task) {
      pending += 1;
      const done = tail.then(task);
      tail = done.then(settle, settle);

      return done;
    },
    settled: () => tail,
    get busy() {
      return pending > 0;
    },
  };
}

/** Returns an empty {@link KeyedSerial}. It holds a key only while that key has tasks queued. */
export function keyedSerial<K>(): KeyedSerial<K> {
  const queues = new Map<K, Serial>();

  return {
    run(key, task) {
      const queue = queues.get(key) ?? serial();
      queues.set(key, queue);
      const done = queue.run(task);

      void queue.settled().then(() => {
        if (!queue.busy && queues.get(key) === queue) queues.delete(key);
      });

      return done;
    },
  };
}
