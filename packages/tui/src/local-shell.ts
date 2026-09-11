import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream, type WriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";

export type ShellExecution = {
  readonly kind: "shell";
  readonly id: string;
  readonly command: string;
  readonly startedAt: number;
  readonly output: string;
} & (
  | { readonly state: "running" }
  | { readonly state: "exited"; readonly exitCode: number; readonly finishedAt: number }
  | { readonly state: "cancelled"; readonly finishedAt: number }
  | { readonly state: "signalled"; readonly signal: string; readonly finishedAt: number }
  | { readonly state: "failed"; readonly message: string; readonly finishedAt: number }
);

export interface ShellProcess {
  readonly snapshot: ShellExecution;
  readonly done: Promise<Exclude<ShellExecution, { readonly state: "running" }>>;
  cancel(): void;
}

export function startLocalShell(options: {
  readonly command: string;
  readonly cwd: string;
  readonly onUpdate: (snapshot: ShellExecution) => void;
  readonly signal: AbortSignal;
}): ShellProcess {
  let snapshot: ShellExecution = {
    kind: "shell",
    id: randomUUID(),
    command: options.command,
    startedAt: Date.now(),
    output: "",
    state: "running",
  };
  const completion =
    Promise.withResolvers<Exclude<ShellExecution, { readonly state: "running" }>>();
  // Leave room for the log notice inside the roughly 50 KB display budget.
  const tail = Buffer.alloc(48 * 1024);
  let cursor = 0;
  let length = 0;
  let logPath: string | undefined;
  let log: WriteStream | undefined;
  let logClosed: Promise<void> = Promise.resolve();
  let notification: ReturnType<typeof setTimeout> | undefined;
  let child: ChildProcess | undefined;
  let ownedPid: number | undefined;
  let cleanup: Promise<void> = Promise.resolve();
  let cancelled = options.signal.aborted;
  let exited = false;
  let failure: string | undefined;

  function output() {
    const bytes =
      length < tail.length
        ? tail.subarray(0, length)
        : Buffer.concat([tail.subarray(cursor), tail.subarray(0, cursor)]);
    // A byte-limited tail can start partway through a UTF-8 character.
    let start = 0;
    while (start < bytes.length && (bytes[start] ?? 0) >> 6 === 2) start++;
    const text = bytes.toString("utf8", start);
    return logPath ? `[Output truncated. Full output: ${logPath}]\n${text}` : text;
  }

  function publish() {
    notification = undefined;
    snapshot = { ...snapshot, output: output() };
    options.onUpdate(snapshot);
  }

  function killOwnedProcesses() {
    const pid = ownedPid;
    // Revoke ownership before signalling. In particular, cancellation after exit
    // must never send a delayed signal to a recycled process/group ID.
    ownedPid = undefined;
    if (pid === undefined) return;
    if (process.platform === "win32") {
      cleanup = new Promise((resolve) => {
        const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        });
        killer.once("error", (error) => {
          failure ??= error.message;
          child?.kill("SIGKILL");
        });
        killer.once("close", (code) => {
          if (code !== 0 && !exited) {
            failure ??= "Could not stop the shell process tree.";
            child?.kill("SIGKILL");
          }
          resolve();
        });
      });
      return;
    }
    try {
      process.kill(-pid, "SIGKILL");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) {
        failure ??= error instanceof Error ? error.message : String(error);
        child?.kill("SIGKILL");
      }
    }
  }

  function cancel() {
    if (exited || snapshot.state !== "running" || cancelled) return;
    cancelled = true;
    killOwnedProcesses();
  }

  function append(text: string) {
    if (!text) return;
    const bytes = Buffer.from(text);
    if (!log && length + bytes.length > tail.length && failure === undefined) {
      logPath = join(tmpdir(), `nyte-shell-${snapshot.id}.log`);
      log = createWriteStream(logPath, { flags: "wx", mode: 0o600 });
      logClosed = new Promise((resolve) => log?.once("close", () => resolve()));
      log.on("error", (error) => {
        failure ??= error.message;
        killOwnedProcesses();
        child?.stdout?.resume();
        child?.stderr?.resume();
      });
      log.on("drain", () => {
        child?.stdout?.resume();
        child?.stderr?.resume();
      });
      log.write(Buffer.from(tail.subarray(0, length)));
    }
    if (log && !log.destroyed && !log.write(bytes)) {
      child?.stdout?.pause();
      child?.stderr?.pause();
    }
    if (bytes.length >= tail.length) {
      bytes.copy(tail, 0, bytes.length - tail.length);
      cursor = 0;
    } else {
      const first = Math.min(bytes.length, tail.length - cursor);
      bytes.copy(tail, cursor, 0, first);
      bytes.copy(tail, 0, first);
      cursor = (cursor + bytes.length) % tail.length;
    }
    length = Math.min(tail.length, length + bytes.length);
    notification ??= setTimeout(publish, 100);
  }

  async function finish(exitCode: number | null, signal: string | null) {
    exited = true;
    options.signal.removeEventListener("abort", cancel);
    if (notification !== undefined) clearTimeout(notification);
    notification = undefined;
    log?.end();
    await Promise.all([cleanup, logClosed]);
    const terminal = { ...snapshot, output: output(), finishedAt: Date.now() };
    snapshot =
      failure !== undefined
        ? { ...terminal, state: "failed", message: failure }
        : cancelled
          ? { ...terminal, state: "cancelled" }
          : signal !== null
            ? { ...terminal, state: "signalled", signal }
            : exitCode !== null
              ? { ...terminal, state: "exited", exitCode }
              : { ...terminal, state: "failed", message: "Shell exited without an exit status." };
    completion.resolve(snapshot);
    options.onUpdate(snapshot);
  }

  options.signal.addEventListener("abort", cancel, { once: true });
  // The controller must register ownership before any update, including launch
  // failure and a signal that was already aborted when this function was called.
  queueMicrotask(() => {
    if (cancelled) {
      void finish(null, null);
      return;
    }
    try {
      const launched =
        process.platform === "win32"
          ? spawn(options.command, {
              cwd: options.cwd,
              shell: process.env.ComSpec || "cmd.exe",
              windowsHide: true,
              stdio: ["ignore", "pipe", "pipe"],
            })
          : spawn(
              "/bin/sh",
              [
                "-c",
                // The reader pins the process group until cleanup, even if the
                // command exits first. exec preserves its native exit status/signal.
                '(read -r _ <&3) & exec 3<&-; exec /bin/sh -c "$1"',
                "nyte-shell",
                options.command,
              ],
              {
                cwd: options.cwd,
                detached: true,
                stdio: ["ignore", "pipe", "pipe", "pipe"],
              },
            );
      child = launched;
      ownedPid = launched.pid;
      // Each stream needs its own decoder. A partial stdout character must not
      // consume stderr bytes, and vice versa.
      for (const stream of [launched.stdout, launched.stderr]) {
        if (!stream) continue;
        const decoder = new StringDecoder("utf8");
        stream.on("data", (bytes: Buffer) => append(decoder.write(bytes)));
        stream.once("end", () => append(decoder.end()));
        stream.once("error", (error) => {
          failure ??= error.message;
          killOwnedProcesses();
        });
      }
      launched.once("error", (error) => {
        failure ??= error.message;
        exited = true;
        ownedPid = undefined;
      });
      launched.once("exit", () => {
        exited = true;
        // Do not wait for close: descendants can still hold these pipes open.
        killOwnedProcesses();
        launched.stdio[3]?.destroy();
      });
      launched.once("close", (exitCode, signal) => {
        void finish(exitCode, signal);
      });
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      void finish(null, null);
    }
  });

  return {
    get snapshot() {
      return snapshot;
    },
    done: completion.promise,
    cancel,
  };
}
