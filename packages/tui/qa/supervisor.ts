import process from "node:process";
import { constants } from "node:os";

// This process is the PTY's group leader. Only it signals the group, so an
// exited leader's remembered PID can never target a reused process group.
process.on("SIGINT", () => {});
process.on("SIGTERM", () => {});
process.on("SIGHUP", () => {});
const keepAlive = setInterval(() => {}, 60_000);
let child: ReturnType<typeof Bun.spawn> | undefined;
let binaryExit: Promise<void> | undefined;
let cleaning = false;
let prepared = false;

function send(message: object) {
  if (process.connected) process.send?.(message);
}

function finish() {
  process.kill(-process.pid, "SIGKILL");
}

function fail(error: unknown) {
  send({ kind: "error", message: error instanceof Error ? error.message : String(error) });
  // Do not leave descendants behind even if startup or control IPC fails.
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
  // The driver's reply proves it received the actual exit status before the
  // final group kill also terminates this owner and closes the private IPC.
  send({ kind: "prepared" });
}

process.on("disconnect", () => {
  if (prepared) finish();
  else void cleanup().catch(fail);
});
process.on("message", (message: unknown) => {
  try {
    if (typeof message !== "object" || message === null || !("kind" in message))
      throw new Error("Invalid QA supervisor command.");
    if (
      message.kind === "cleanup" &&
      "signal" in message &&
      (message.signal === "SIGINT" || message.signal === "SIGTERM")
    ) {
      void cleanup(message.signal).catch(fail);
      return;
    }
    if (message.kind === "finish" && prepared) {
      finish();
      return;
    }
    if (
      message.kind === "signal" &&
      "signal" in message &&
      (message.signal === "SIGINT" || message.signal === "SIGTERM" || message.signal === "SIGKILL")
    ) {
      // Signal the owned child handle, not a PID retained after its exit.
      if (child && child.exitCode === null && child.signalCode === null) child.kill(message.signal);
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
    send({ kind: "exited", code: signal === null ? code : 128 + constants.signals[signal] });
  });
} catch (error) {
  clearInterval(keepAlive);
  fail(error);
}
