/**
 * Everything a plugin registers is tracked here so disposing the scope undoes
 * the plugin completely. Dispose runs in reverse order with a budget per
 * disposer; a slow or throwing disposer is reported and skipped, never raised.
 */
import type { Disposer } from "./types.ts";

type AsyncDisposer = () => void | Promise<void>;

export interface ScopeReporter {
  (error: Error): void;
}

export class PluginScope {
  readonly id: string;
  readonly controller = new AbortController();
  private disposers: AsyncDisposer[] = [];
  private disposed = false;
  private published = false;
  private publications: (() => void)[] = [];
  private registrations: Disposer[] = [];
  private readonly calls = new Set<Promise<unknown>>();
  private readonly budgetMs: number;
  private readonly report: ScopeReporter;

  constructor(id: string, report: ScopeReporter, budgetMs = 5_000) {
    this.id = id;
    this.report = report;
    this.budgetMs = budgetMs;
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get closed(): boolean {
    return this.disposed || this.signal.aborted;
  }

  assertOpen(): void {
    if (this.closed) throw new Error(`plugin ${this.id} is disposed`);
  }

  onPublish(action: () => void): void {
    this.assertOpen();
    if (this.published) action();
    else this.publications.push(action);
  }

  publish(): void {
    this.assertOpen();
    this.published = true;
    for (const action of this.publications) action();
    this.publications = [];
  }

  registration(disposer: Disposer): Disposer {
    this.assertOpen();
    this.registrations.push(disposer);
    return disposer;
  }

  async call<T>(action: () => T | Promise<T>): Promise<T> {
    this.assertOpen();
    const { promise, resolve } = Promise.withResolvers<void>();
    this.calls.add(promise);
    try {
      return await action();
    } finally {
      this.calls.delete(promise);
      resolve();
    }
  }

  track<T extends Disposer | AsyncDisposer>(disposer: T): T {
    if (this.disposed) {
      void Promise.resolve(disposer()).catch((cause: unknown) => this.report(normalize(cause)));

      return disposer;
    }

    this.disposers.push(disposer);

    return disposer;
  }

  /** Run `setup` with the scope's signal; a returned disposer is tracked; a throw is reported. */
  effect(setup: (signal: AbortSignal) => void | Disposer | Promise<void | Disposer>): void {
    void Promise.resolve()
      .then(() => setup(this.signal))
      .then((disposer) => {
        if (disposer) this.track(disposer);
      })
      .catch((cause: unknown) => this.report(normalize(cause)));
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.publications = [];
    for (const remove of this.registrations.reverse()) remove();
    this.registrations = [];
    await Promise.allSettled(this.calls);
    this.controller.abort();
    const disposers = this.disposers.reverse();
    this.disposers = [];

    for (const disposer of disposers) {
      try {
        await withBudget({ what: "disposer", ms: this.budgetMs }, () => disposer());
      } catch (error) {
        this.report(normalize(error));
      }
    }
  }
}

function normalize(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

/**
 * Run plugin code under a wall-clock budget. The signal handed to `call`
 * aborts when the budget runs out and whenever `signal` does; the rejection
 * names `what`. A synchronous throw rejects the same way.
 */
export function withBudget<T>(
  options: { readonly what: string; readonly ms: number; readonly signal?: AbortSignal },
  call: (signal: AbortSignal) => T | Promise<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();

    const signal =
      options.signal === undefined
        ? controller.signal
        : AbortSignal.any([options.signal, controller.signal]);

    const timer = setTimeout(() => {
      const error = new Error(`${options.what} exceeded ${options.ms}ms`);
      controller.abort(error);
      reject(error);
    }, options.ms);

    try {
      Promise.resolve(call(signal))
        .then(resolve, reject)
        .finally(() => clearTimeout(timer));
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}
