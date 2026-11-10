import { once } from "node:events";
import { Worker } from "node:worker_threads";
import { AuthorityType } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Compile } from "typebox/compile";

const PortType = Type.Integer({ minimum: 0, maximum: 65_535 });

const SupervisorType = Type.Enum(["launchd", "nyte"]);

export type Supervisor = Static<typeof SupervisorType>;

const HostCommandType = Type.Object({
  kind: Type.Literal("local"),
  port: PortType,
  token: Type.String(),
  authority: Type.Array(AuthorityType),
  socket: Type.Optional(Type.String()),
  tailnet: Type.Optional(Type.String()),
  workspace: Type.Optional(Type.String()),
  supervisor: Type.Union([SupervisorType, Type.Null()]),
});

export type HostCommand = Static<typeof HostCommandType>;

export const OWN_TOKEN_AUTHORITY: HostCommand["authority"] = [
  "participant",
  "owner",
  "maintenance",
];

const HostMessageType = Type.Union([HostCommandType, Type.Object({ kind: Type.Literal("stop") })]);

const HostReportType = Type.Union([
  Type.Object({ kind: Type.Literal("listening"), address: Type.String() }),
  Type.Object({ kind: Type.Literal("failed"), message: Type.String() }),
  Type.Object({ kind: Type.Literal("revoked") }),
  Type.Object({ kind: Type.Literal("replaced") }),
  Type.Object({ kind: Type.Literal("closed") }),
]);

type HostMessage = Static<typeof HostMessageType>;

export type HostReport = Static<typeof HostReportType>;

export const hostMessages = Compile(HostMessageType);

const hostReports = Compile(HostReportType);

export type HostWorkerEntry = string | URL;

interface HostThread {
  readonly address: string;
  readonly ended: Promise<void>;
  stop(): Promise<void>;
}

interface Running {
  readonly worker: Worker;
  readonly address: string;
  readonly closed: Promise<void>;
}

function launch(
  entry: HostWorkerEntry,
  command: HostCommand,
  revoked: () => void,
  replaced: () => void,
  failed: (cause: Error) => void,
) {
  const worker = new Worker(entry);

  const listening = Promise.withResolvers<string>();
  const closed = Promise.withResolvers<void>();
  let opened = false;
  let leaving = false;

  listening.promise.catch(() => undefined);

  const fail = (cause: Error): void => {
    if (!opened) listening.reject(cause);
    else if (!leaving) failed(cause);
    leaving = true;
    closed.resolve();
  };

  worker.on("message", (report) => {
    if (!hostReports.Check(report)) {
      fail(new Error("The host thread sent a message its process does not know."));
      void worker.terminate();

      return;
    }

    switch (report.kind) {
      case "listening":
        opened = true;
        listening.resolve(report.address);

        return;
      case "failed":
        fail(new Error(report.message));
        void worker.terminate();

        return;
      case "revoked":
        leaving = true;
        void worker.terminate().then(revoked);

        return;
      case "replaced":
        leaving = true;
        replaced();

        return;
      case "closed":
        leaving = true;
        closed.resolve();

        return;
      default: {
        const _exhaustive: never = report;

        fail(new Error(`The host thread reported ${JSON.stringify(_exhaustive)}.`));
      }
    }
  });
  worker.on("error", fail);
  worker.on("exit", (code) => fail(new Error(`The host thread exited with code ${String(code)}.`)));
  worker.postMessage(command satisfies HostMessage);

  return listening.promise.then((address): Running => ({
    worker,
    address,
    closed: closed.promise,
  }));
}

export async function startHostThread(
  entry: HostWorkerEntry,
  command: HostCommand,
): Promise<HostThread> {
  const ended = Promise.withResolvers<void>();
  ended.promise.catch(() => undefined);
  let stopping = false;
  let current: Running;

  const failed = (cause: Error): void => {
    if (!stopping) ended.reject(cause);
  };

  const replaced = (): void => ended.resolve();

  const reopen = (): void => {
    if (stopping) return;
    const port = Number(new URL(current.address).port);

    void launch(entry, { ...command, port }, reopen, replaced, failed).then(
      (running) => {
        current = running;

        if (stopping) void running.worker.terminate();
      },
      (cause: unknown) => failed(cause instanceof Error ? cause : new Error(String(cause))),
    );
  };

  current = await launch(entry, command, reopen, replaced, failed);

  return {
    address: current.address,
    ended: ended.promise,
    async stop() {
      stopping = true;
      current.worker.postMessage({ kind: "stop" } satisfies HostMessage);
      const timer = setTimeout(() => void current.worker.terminate(), 10_000);
      await Promise.race([current.closed, once(current.worker, "exit")]);
      clearTimeout(timer);
      await current.worker.terminate();
      ended.resolve();
    },
  };
}
