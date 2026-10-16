import { Worker } from "node:worker_threads";
import { compiled } from "./compiled.ts";

/** What the host thread runs: `nyte serve`'s listener or `nyte service run`'s background service. */
export type HostCommand =
  | { readonly kind: "serve"; readonly port: number; readonly token: string }
  | { readonly kind: "service"; readonly port: number };

/** Messages the CLI thread sends the host thread. */
export type HostMessage = HostCommand | { readonly kind: "stop" };

/** Why the host thread could not start, when the CLI words the failure itself. */
export type HostFailureReason = "port-in-use" | "service-running" | "other";

/** Messages the host thread sends back. */
export type HostReport =
  | { readonly kind: "listening"; readonly address: string }
  | { readonly kind: "failed"; readonly reason: HostFailureReason; readonly message: string }
  | { readonly kind: "closed" };

/** A host command that failed on the host thread. */
export class HostFailure extends Error {
  readonly reason: HostFailureReason;

  constructor(reason: HostFailureReason, message: string) {
    super(message);
    this.name = "HostFailure";
    this.reason = reason;
  }
}

/** A host listening on its own thread. */
export interface HostThread {
  readonly address: string;
  /** Settles when the host closes; rejects when its thread fails or exits first. */
  readonly ended: Promise<void>;
  stop(): Promise<void>;
}

/**
 * Runs a host command on a worker thread whose entry is a separate bundle, so the CLI's
 * module graph never evaluates the host, its providers or its store. Resolves once the
 * host listens; rejects with a `HostFailure` when it can't.
 */
export async function startHostThread(command: HostCommand): Promise<HostThread> {
  const worker = new Worker(
    compiled ? "./tui/src/host-worker.ts" : new URL("./host-worker.ts", import.meta.url),
  );

  const listening = Promise.withResolvers<string>();
  const ended = Promise.withResolvers<void>();
  let running = true;

  ended.promise.catch(() => undefined);

  const fail = (cause: unknown): void => {
    listening.reject(cause);

    if (!running) return;
    running = false;
    ended.reject(cause);
  };

  worker.on("message", (report: HostReport) => {
    if (report.kind === "listening") {
      listening.resolve(report.address);

      return;
    }

    if (report.kind === "failed") {
      fail(new HostFailure(report.reason, report.message));
      void worker.terminate();

      return;
    }

    running = false;
    ended.resolve();
  });
  worker.on("error", fail);
  worker.on("exit", (code) => fail(new Error(`The host thread exited with code ${String(code)}.`)));
  worker.postMessage(command satisfies HostMessage);

  const address = await listening.promise;

  return {
    address,
    ended: ended.promise,
    async stop() {
      if (running) {
        worker.postMessage({ kind: "stop" } satisfies HostMessage);
        await ended.promise;
      }

      await worker.terminate();
    },
  };
}
