import process from "node:process";
import { constants } from "node:os";
import { supervisorCommand } from "./supervisor-protocol.ts";
import type { SupervisorReport } from "./supervisor-protocol.ts";

process.on("SIGINT", () => {});

process.on("SIGTERM", () => {});

process.on("SIGHUP", () => {});

const keepAlive = setInterval(() => {}, 60_000);

let child: ReturnType<typeof Bun.spawn> | undefined;

let binaryExit: Promise<void> | undefined;

let cleaning = false;

let prepared = false;

function send(message: SupervisorReport) {
  if (process.connected) process.send?.(message);
}

function finish() {
  process.kill(-process.pid, "SIGKILL");
}

function fail(cause: unknown) {
  send({ kind: "error", message: cause instanceof Error ? cause.message : String(cause) });
  finish();
}

async function cleanup(signal: "SIGINT" | "SIGTERM" = "SIGTERM") {
  if (cleaning) return;
  cleaning = true;
  process.kill(-process.pid, signal);

  if (child && binaryExit) {
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      await Promise.race([
        binaryExit,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 1500);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }

    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await binaryExit;
  }

  prepared = true;

  if (!process.connected) finish();
  send({ kind: "prepared" });
}

process.on("disconnect", () => {
  if (prepared) finish();
  else void cleanup().catch(fail);
});

process.on("message", (message) => {
  try {
    if (!supervisorCommand.Check(message)) throw new Error("Invalid QA supervisor command.");

    if (message.kind === "cleanup") {
      void cleanup(message.signal).catch(fail);

      return;
    }

    if (message.kind === "signal") {
      if (child && child.exitCode === null && child.signalCode === null) child.kill(message.signal);

      return;
    }

    if (prepared) {
      finish();

      return;
    }

    throw new Error("Invalid QA supervisor command.");
  } catch (error) {
    fail(error);
  }
});

try {
  const [binary, ...args] = process.argv.slice(2);

  if (!binary || !process.send) throw new Error("QA supervisor requires a binary and private IPC.");
  child = Bun.spawn([binary, ...args], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const binaryProcess = child;
  binaryExit = child.exited.then((code) => {
    const signal = binaryProcess.signalCode;

    const number =
      signal === null || typeof signal === "number" ? signal : constants.signals[signal];

    send({ kind: "exited", code: number === null ? code : 128 + number });
  });
} catch (error) {
  clearInterval(keepAlive);
  fail(error);
}
