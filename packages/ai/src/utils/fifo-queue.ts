/**
 * First-in, first-out storage with amortized constant-time dequeue: values enter one stack and leave the other, which is refilled in reverse only when empty.
 */
export class FifoQueue<T> {
  private incoming: T[] = [];
  private outgoing: T[] = [];

  get length(): number {
    return this.incoming.length + this.outgoing.length;
  }

  enqueue(value: T): void {
    this.incoming.push(value);
  }

  dequeue(): T | undefined {
    if (this.outgoing.length === 0) {
      const drained = this.incoming;
      drained.reverse();
      this.incoming = this.outgoing;
      this.outgoing = drained;
    }

    return this.outgoing.pop();
  }

  clear(): void {
    this.incoming = [];
    this.outgoing = [];
  }
}
