import { Worker } from "node:worker_threads";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Compile } from "typebox/compile";
import { compiled } from "./compiled.ts";

const PortType = Type.Integer({ minimum: 0, maximum: 65_535 });

const HostCommandType = Type.Union([
  Type.Object({ kind: Type.Literal("serve"), port: PortType, token: Type.String() }),
  Type.Object({ kind: Type.Literal("service"), port: PortType }),
]);

const HostFailureReasonType = Type.Union([
  Type.Literal("port-in-use"),
  Type.Literal("service-running"),
  Type.Literal("other"),
]);

/** What the host thread runs: `nyte serve`'s listener or `nyte service run`'s background service. */
export type HostCommand = Static<typeof HostCommandType>;

/** Why the host thread could not start, when the CLI words the failure itself. */
export type HostFailureReason = Static<typeof HostFailureReasonType>;

const HostMessageType = Type.Union([HostCommandType, Type.Object({ kind: Type.Literal("stop") })]);

const HostReportType = Type.Union([
  Type.Object({ kind: Type.Literal("listening"), address: Type.String() }),
  Type.Object({
    kind: Type.Literal("failed"),
    reason: HostFailureReasonType,
    message: Type.String(),
  }),
  Type.Object({ kind: Type.Literal("closed") }),
]);

/** Messages the CLI thread sends the host thread: a command, or stop. */
type HostMessage = Static<typeof HostMessageType>;

/** Messages the host thread sends back. */
export type HostReport = Static<typeof HostReportType>;

/** Checks a message from the CLI thread on the host thread. */
export const hostMessages = Compile(HostMessageType);

const hostReports = Compile(HostReportType);

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
interface HostThread {
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

  worker.on("message", (report) => {
    if (!hostReports.Check(report)) {
      fail(new Error("The host thread sent a message the CLI does not know."));
      void worker.terminate();

      return;
    }

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
