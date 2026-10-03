/**
 * Async event queue with a promise for the terminal result. AssistantMessageEventStream is the stream every adapter returns: events are pushed as they arrive, and `result()` resolves with the final AssistantMessage once `done` or `error` is pushed.
 *
 * Based on https://github.com/earendil-works/pi/blob/dev/packages/ai/src/utils/event-stream.ts
 * Synced with pi 7fbbd5f4a.
 */
import type { AssistantMessage, AssistantMessageEvent } from "@nyte-ai/schema";
import { FifoQueue } from "./fifo-queue.ts";

// Generic event stream class for async iteration
export class EventStream<T, R = T> implements AsyncIterable<T> {
  private queue = new FifoQueue<IteratorYieldResult<T>>();
  private waiting = new FifoQueue<(value: IteratorResult<T>) => void>();
  private done = false;
  private finalResult = Promise.withResolvers<R>();
  private isComplete: (event: T) => boolean;
  private extractResult: (event: T) => R;

  constructor(isComplete: (event: T) => boolean, extractResult: (event: T) => R) {
    this.isComplete = isComplete;
    this.extractResult = extractResult;
  }

  push(event: T): void {
    if (this.done) return;

    if (this.isComplete(event)) {
      this.done = true;
      this.finalResult.resolve(this.extractResult(event));
    }

    // Deliver to waiting consumer or queue it
    const next: IteratorYieldResult<T> = { value: event, done: false };
    const waiter = this.waiting.dequeue();

    if (waiter) {
      waiter(next);
    } else {
      this.queue.enqueue(next);
    }
  }

  end(result?: R): void {
    this.done = true;

    if (result !== undefined) {
      this.finalResult.resolve(result);
    }

    // Notify all waiting consumers that we're done
    for (let waiter = this.waiting.dequeue(); waiter; waiter = this.waiting.dequeue()) {
      waiter({ value: undefined, done: true });
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      const queued = this.queue.dequeue();

      if (queued) {
        yield queued.value;
      } else if (this.done) {
        return;
      } else {
        const result = await new Promise<IteratorResult<T>>((resolve) =>
          this.waiting.enqueue(resolve),
        );

        if (result.done) return;
        yield result.value;
      }
    }
  }

  result(): Promise<R> {
    return this.finalResult.promise;
  }
}

export class AssistantMessageEventStream extends EventStream<
  AssistantMessageEvent,
  AssistantMessage
> {
  constructor() {
    super(
      (event) => event.type === "done" || event.type === "error",
      (event) => {
        if (event.type === "done") {
          return event.message;
        } else if (event.type === "error") {
          return event.error;
        }

        throw new Error("Unexpected event type for final result");
      },
    );
  }
}

/** Factory function for AssistantMessageEventStream (for use in extensions) */
export function createAssistantMessageEventStream(): AssistantMessageEventStream {
  return new AssistantMessageEventStream();
}
