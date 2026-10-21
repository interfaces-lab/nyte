import { useLayoutEffect } from "react";
import type { ReactElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { useWatch, WatchStore } from "./sdk.tsx";

function numbers() {
  const queued: number[] = [];
  let waiting: ((value: number) => void) | undefined;

  return {
    push(value: number): void {
      const wake = waiting;
      waiting = undefined;

      if (wake === undefined) queued.push(value);
      else wake(value);
    },
    open: (): AsyncIterable<number> => ({
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          const value =
            queued.shift() ??
            (await new Promise<number>((resolve) => {
              waiting = resolve;
            }));

          return { done: false, value };
        },
        return: async () => {
          waiting = undefined;

          return { done: true, value: undefined };
        },
      }),
    }),
  };
}

function painted(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

function elapsed(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let commits = 0;

function Shown({ store }: { readonly store: WatchStore<number> }): ReactElement {
  const { value } = useWatch(store);

  useLayoutEffect(() => {
    commits += 1;
  });

  return <output>{value === undefined ? "none" : String(value)}</output>;
}

export async function run(): Promise<string> {
  const request = window.requestAnimationFrame.bind(window);
  const cancel = window.cancelAnimationFrame.bind(window);
  const pending = new Set<number>();
  let paused = false;
  let pausedFrames = 0;

  window.requestAnimationFrame = (callback) => {
    if (paused) {
      pausedFrames -= 1;
      pending.add(pausedFrames);

      return pausedFrames;
    }

    const frame = request((time) => {
      pending.delete(frame);
      callback(time);
    });
    pending.add(frame);

    return frame;
  };

  window.cancelAnimationFrame = (frame) => {
    pending.delete(frame);
    cancel(frame);
  };

  const source = numbers();
  const store = new WatchStore(source.open);
  const heard: (number | null)[] = [];
  const rendered: (number | null)[] = [];

  const leaveHeard = store.subscribe(() => {
    heard.push(store.value ?? null);
  });

  const leaveRendered = store.subscribeByFrame(() => {
    rendered.push(store.value ?? null);
  });

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const shown = (): string => container.textContent ?? "";

  try {
    const opened = store.next();
    source.push(0);
    await opened;
    flushSync(() => root.render(<Shown store={store} />));
    await painted();
    const first = { heard: [...heard], rendered: [...rendered], shown: shown() };

    commits = 0;
    const atFrame = new Promise<{ heard: number; rendered: number }>((resolve) => {
      requestAnimationFrame(() => resolve({ heard: heard.length, rendered: rendered.length }));
    });

    for (const value of [1, 2, 3, 4, 5]) source.push(value);
    const beforeFlush = await atFrame;
    await painted();

    const burst = {
      heard: heard.slice(1),
      beforeFlush: { heard: beforeFlush.heard - 1, rendered: beforeFlush.rendered - 1 },
      rendered: rendered.slice(1),
      commits,
      shown: shown(),
    };

    commits = 0;

    for (const value of [6, 7, 8]) {
      source.push(value);
      await painted();
    }

    const perFrame = { commits, shown: shown() };

    paused = true;
    const beforeHidden = rendered.length;
    source.push(9);
    await elapsed(40);
    const early = rendered.slice(beforeHidden);
    await elapsed(120);
    const hidden = {
      early,
      late: rendered.slice(beforeHidden),
      shown: shown(),
      pending: pending.size,
    };
    paused = false;

    const beforeRetry = rendered.length;
    const ten = store.next();
    source.push(10);
    await ten;
    const queuedBeforeRetry = pending.size;
    store.retry();

    const retried = {
      queued: queuedBeforeRetry,
      pending: pending.size,
      rendered: rendered.slice(beforeRetry),
    };

    const eleven = store.next();
    source.push(11);
    await eleven;
    const rescheduled = pending.size;
    await painted();
    const retry = { ...retried, rescheduled, afterFrame: rendered.slice(beforeRetry) };

    const beforeDispose = rendered.length;
    const twelve = store.next();
    source.push(12);
    await twelve;
    const queuedBeforeDispose = pending.size;
    store.dispose();

    const disposed = {
      queued: queuedBeforeDispose,
      pending: pending.size,
      rendered: rendered.slice(beforeDispose),
    };

    await painted();
    const dispose = { ...disposed, afterFrame: rendered.slice(beforeDispose), shown: shown() };

    return JSON.stringify({ first, burst, perFrame, hidden, retry, dispose });
  } finally {
    leaveHeard();
    leaveRendered();
    flushSync(() => root.unmount());
    container.remove();
    window.requestAnimationFrame = request;
    window.cancelAnimationFrame = cancel;
  }
}
