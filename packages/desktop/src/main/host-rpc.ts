/** A request's settled answer as it crosses the process boundary. */
export type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

/** What one side of an {@link Rpc} sends: its asks, its aborts of them, and its answers to the other side's asks. */
export type RpcMessage<Ask, Answer> =
  | { readonly kind: "ask"; readonly id: number; readonly ask: Ask }
  | { readonly kind: "abort"; readonly id: number }
  | { readonly kind: "settle"; readonly id: number; readonly outcome: Outcome<Answer> };

/**
 * Requests in both directions over one message port, used by main and the host process alike.
 * `ask` settles with the other side's outcome; `receive` routes the other side's messages and
 * answers its asks through `serve`, posting a settle whether `serve` fulfils or rejects.
 * `close` rejects every pending ask and aborts every ask being served.
 */
export class Rpc<Ask, Answer, Served, Serves> {
  readonly #post: (message: RpcMessage<Ask, Serves>) => void;
  readonly #serve: (ask: Served, signal: AbortSignal) => Promise<Serves>;
  readonly #pending = new Map<number, (outcome: Outcome<Answer>) => void>();
  readonly #serving = new Map<number, AbortController>();
  #next = 0;
  #closed: string | undefined;

  constructor(
    post: (message: RpcMessage<Ask, Serves>) => void,
    serve: (ask: Served, signal: AbortSignal) => Promise<Serves>,
  ) {
    this.#post = post;
    this.#serve = serve;
  }

  /** Asks the other side; an aborted `signal` tells it to give up on the ask. */
  ask(ask: Ask, signal?: AbortSignal): Promise<Answer> {
    if (this.#closed !== undefined) return Promise.reject(new Error(this.#closed));

    const id = ++this.#next;
    const abort = (): void => this.#post({ kind: "abort", id });

    return new Promise((resolve, reject) => {
      this.#pending.set(id, (outcome) => {
        signal?.removeEventListener("abort", abort);

        if (outcome.ok) resolve(outcome.value);
        else reject(new Error(outcome.message));
      });
      signal?.addEventListener("abort", abort, { once: true });
      this.#post({ kind: "ask", id, ask });
    });
  }

  receive(message: RpcMessage<Served, Answer>): void {
    switch (message.kind) {
      case "ask":
        this.#answer(message.id, message.ask);

        return;
      case "abort":
        this.#serving.get(message.id)?.abort();

        return;
      case "settle":
        this.#pending.get(message.id)?.(message.outcome);
        this.#pending.delete(message.id);

        return;
      default: {
        const _exhaustive: never = message;

        return _exhaustive;
      }
    }
  }

  /** The other side is gone: pending asks reject with `message` and served asks abort. */
  close(message: string): void {
    this.#closed = message;

    for (const settle of this.#pending.values()) settle({ ok: false, message });
    this.#pending.clear();

    for (const serving of this.#serving.values()) serving.abort();
    this.#serving.clear();
  }

  #answer(id: number, ask: Served): void {
    const serving = new AbortController();

    this.#serving.set(id, serving);
    void Promise.try(() => this.#serve(ask, serving.signal))
      .then(
        (value): Outcome<Serves> => ({ ok: true, value }),
        (cause: unknown): Outcome<Serves> => ({
          ok: false,
          message: cause instanceof Error ? cause.message : String(cause),
        }),
      )
      .then((outcome) => {
        this.#serving.delete(id);
        this.#post({ kind: "settle", id, outcome });
      });
  }
}
