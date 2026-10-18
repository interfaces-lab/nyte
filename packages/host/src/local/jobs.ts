import { spawn } from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { IPty, IPtyForkOptions } from "@lydell/node-pty";
import { asId, SdkError } from "@nyte-ai/schema";
import type { JobEnd, OutputFrame, RequestOptions } from "@nyte-ai/schema";
import {
  processEnvironment,
  closable,
  dev,
  readTraceparent,
  startSpan,
  tracing,
} from "@nyte-ai/core";
import type { EndSpan, ExecutionEnv, Job } from "@nyte-ai/core";
import { findExecutable, spawnCommand } from "./command.ts";

type PtyModule = {
  spawn(file: string, args: string[] | string, options: IPtyForkOptions): IPty;
};

type Driver = {
  write(bytes: Uint8Array): Promise<void>;
  resize(size: { readonly columns: number; readonly rows: number }): boolean;
  idle(): boolean;
  kill(signal: NodeJS.Signals): void;
  readonly pty: boolean;
};

const OUTPUT_LIMIT = 1024 * 1024;

/** How far the slowest reader may fall behind a pty before it pauses, and how close it must come again before the pty resumes. */
const PAUSE_BYTES = 256 * 1024;

const RESUME_BYTES = 64 * 1024;

const STOP_GRACE_MS = 2_000;

const CLOSE_GRACE_MS = 2_000;

const QUIET_MS = 300;

const DONE = { done: true, value: undefined } as const;

const ESC = "\u001b";

const BEL = "\u0007";

const PROMPT_MARKER = new RegExp(`${ESC}\\]133;([ABCD])`, "g");

let loaded: PtyModule | null | undefined;

/** Returns `exec` for a folder: each call starts one process as a `Job` (a fresh id; `key` null, core keys pty jobs) in `cwd` resolved against `root` (default `root`), with `env` laid over `process.env`. A string command runs through the platform shell (`/bin/sh -c`, `cmd.exe /d /s /c` on Windows) and an argv directly; `[]` with `pty` runs the login shell (`shell()` read at each start, else `$SHELL`, else `/bin/sh`, as a login shell; §37h), a pty's environment carrying `TERM=xterm-256color`, `COLORTERM=truecolor` and `TERM_PROGRAM=Nyte` without Electron's `ELECTRON_RUN_AS_NODE` and `NODE_OPTIONS`, and `[]` without one throws `SdkError("invalid")`. A program that cannot start throws `SdkError("unavailable")`. Without `pty` the process is piped through `node:child_process` in its own process group, stdout and stderr interleaved in `output` (with `stdio: "protocol"`, stderr's frames tagged `stream: "stderr"` and the pipe paced like a pty, so a reader open from the start misses nothing) and stdin fed by `write`; with `pty` it runs under `@lydell/node-pty`, loaded on first use through `createRequire` (§41a; `loadPty`, given, loads it instead, on every pty start), at the given size, and a platform where it does not load throws `SdkError("unavailable")`. `output()` opens a reader over the last 1 MiB of output that yields `bytes`, a `gap` where the reader fell behind or opened after output was dropped, and `exit { code }` last; a merged pipe never stalls, and a pty or a protocol pipe pauses while its slowest open reader is 256 KiB behind, resuming once it is within 64 KiB. `resize` resizes a pty (`not-pty` for a pipe, `missing` once it ended); `idle` answers whether a pty's shell sits at a prompt: by its OSC 133 prompt markers once it sent one, else when it has printed nothing for 300 ms and the cursor's line holds text after the last newline, as a prompt does (false for a pipe); `stop` sends SIGTERM to a pipe's process group (SIGHUP to a pty), SIGKILL after 2 s (on Windows, which has no signals, it ends a pipe's process tree at once with `taskkill /T /F`), and answers `settled { outcome }` (also once it ended); `settled` resolves `exited { code, reason }` (`code` null after a signal), `reason` `exited` when the process ended on its own and `terminated` after `stop` or an aborted `signal`, and an aborted `settled` signal rejects with `SdkError("unavailable")`; `close` detaches this handle's readers. An aborted `signal` stops the process. `signal` on the options ends every reader of every job started here, leaving the processes running (what the provider's `close` does). */
export function localExec(
  root: string,
  options?: {
    readonly shell?: () => string | null;
    readonly signal?: AbortSignal;
    readonly loadPty?: () => unknown;
  },
): ExecutionEnv["exec"] {
  const readers = new Set<() => void>();
  const custom = options?.loadPty;
  const load = custom === undefined ? loadPty : () => ptyFrom(custom);

  options?.signal?.addEventListener(
    "abort",
    () => {
      for (const close of readers) close();
    },
    { once: true },
  );

  return async (command, input) => {
    if (input?.signal?.aborted === true) throw new SdkError("unavailable", "aborted");

    if (typeof command !== "string" && command.length === 0 && input?.pty === undefined)
      throw new SdkError("invalid", "An empty command runs only in a pty, as the login shell.");
    const cwd = input?.cwd === undefined ? root : resolve(root, input.cwd);
    await processEnvironment();
    const env = { ...process.env, ...input?.env };
    const trace = readTraceparent(input?.env?.TRACEPARENT);
    const spawned = startSpan("pty.spawn", trace, { pty: input?.pty !== undefined });
    const log = tracedOutput(createOutputLog(OUTPUT_LIMIT), trace);
    let settle: (end: JobEnd) => void = () => undefined;

    const ended = new Promise<JobEnd>((done) => {
      settle = done;
    });

    let stopping = false;
    let finished: JobEnd | null = null;

    const finish = (code: number | null): void => {
      if (finished !== null) return;
      finished = { kind: "exited", code, reason: stopping ? "terminated" : "exited" };
      dev("jobs", "exit", { code, reason: finished.reason });
      log.end(code);
      settle(finished);
    };

    const driver =
      input?.pty === undefined
        ? await pipe(command, { cwd, env, protocol: input?.stdio === "protocol" }, log, finish)
        : await terminal(
            command,
            { cwd, env, size: input.pty, shell: options?.shell?.() ?? undefined, load },
            log,
            finish,
          );

    spawned();

    dev("jobs", "start", {
      program: typeof command === "string" ? command.split(/\s/, 1)[0] : (command[0] ?? null),
      args: typeof command === "string" ? null : command.length - 1,
      pty: driver.pty,
    });

    let stopped: Promise<JobEnd> | null = null;

    const stop = (): Promise<JobEnd> => {
      stopped ??= (async () => {
        if (finished !== null) return finished;
        stopping = true;
        driver.kill(driver.pty ? "SIGHUP" : "SIGTERM");
        const timer = setTimeout(() => driver.kill("SIGKILL"), STOP_GRACE_MS);

        try {
          return await ended;
        } finally {
          clearTimeout(timer);
        }
      })();

      return stopped;
    };

    input?.signal?.addEventListener("abort", () => void stop(), { once: true });
    const own = new Set<() => void>();

    const close = async (): Promise<void> => {
      for (const detach of own) detach();
    };

    const job: Job = {
      id: asId<"job">(crypto.randomUUID()),
      key: null,
      write: (bytes) => driver.write(bytes),
      output: () =>
        closable<OutputFrame>(() => {
          const reader = log.reader();

          const detach = (): void => {
            own.delete(detach);
            readers.delete(detach);
            reader.close();
          };

          own.add(detach);
          readers.add(detach);

          return { pull: () => reader.next(), close: detach };
        }),
      async resize(size) {
        if (!driver.pty) return { kind: "not-pty" };

        return finished === null && driver.resize(size) ? { kind: "resized" } : { kind: "missing" };
      },
      idle: async () => finished === null && driver.idle(),
      stop: async () => ({ kind: "settled", outcome: await stop() }),
      settled: (request) => waitEnd(ended, request),
      close,
      [Symbol.asyncDispose]: close,
    };

    return job;
  };
}

async function pipe(
  command: string | readonly string[],
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv; readonly protocol: boolean },
  log: OutputLog,
  finish: (code: number | null) => void,
): Promise<Driver> {
  const windows = process.platform === "win32";
  const [file, ...args] = typeof command === "string" ? [command] : command;

  const settings: SpawnOptions = {
    cwd: options.cwd,
    env: options.env,
    detached: !windows,
    stdio: "pipe",
    windowsHide: true,
  };

  const child: ChildProcess =
    typeof command === "string"
      ? spawn(command, { ...settings, shell: true })
      : spawnCommand(
          windows ? ((await findExecutable(file ?? "")) ?? file ?? "") : (file ?? ""),
          args,
          settings,
        );

  await new Promise<void>((started, failed) => {
    child.once("spawn", started);
    child.once("error", (error) =>
      failed(new SdkError("unavailable", `Cannot start ${file ?? ""}: ${error.message}`)),
    );
  });

  child.stdout?.on("data", (chunk: Buffer) => log.push(chunk));
  child.stderr?.on("data", (chunk: Buffer) =>
    log.push(chunk, options.protocol ? "stderr" : undefined),
  );

  if (options.protocol)
    log.throttle({
      pause: () => {
        child.stdout?.pause();
        child.stderr?.pause();
      },
      resume: () => {
        child.stdout?.resume();
        child.stderr?.resume();
      },
    });
  child.stdin?.on("error", () => undefined);
  child.on("close", (code) => finish(code));
  child.on("exit", (code) => {
    setTimeout(() => {
      child.stdout?.destroy();
      child.stderr?.destroy();
      finish(code);
    }, CLOSE_GRACE_MS).unref();
  });

  return {
    pty: false,
    async write(bytes) {
      const stdin = child.stdin;

      if (stdin === null || !stdin.writable)
        throw new SdkError("unavailable", "The process no longer reads its input.");
      await new Promise<void>((written) => stdin.write(bytes, () => written()));
    },
    resize: () => false,
    idle: () => false,
    kill(signal) {
      if (windows && child.pid !== undefined) {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        }).on("error", () => child.kill(signal));

        return;
      }

      try {
        if (child.pid !== undefined) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        child.kill(signal);
      }
    },
  };
}

/** The environment a pty starts with: the process's, as a terminal emulator announces itself, without the variables that would make a child Node or Electron run as the host does. */
function terminalEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { ELECTRON_RUN_AS_NODE: _electron, NODE_OPTIONS: _node, ...rest } = env;

  return { ...rest, TERM: "xterm-256color", COLORTERM: "truecolor", TERM_PROGRAM: "Nyte" };
}

async function terminal(
  command: string | readonly string[],
  options: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly size: { readonly columns: number; readonly rows: number };
    readonly shell: string | undefined;
    readonly load: () => PtyModule | null;
  },
  log: OutputLog,
  finish: (code: number | null) => void,
): Promise<Driver> {
  const pty = options.load();

  if (pty === null)
    throw new SdkError(
      "unavailable",
      "Terminals need @lydell/node-pty, which does not load on this platform.",
    );
  const windows = process.platform === "win32";

  const shell =
    options.shell ??
    (windows ? (process.env.COMSPEC ?? "cmd.exe") : (process.env.SHELL ?? "/bin/sh"));

  const [file, ...args] =
    typeof command === "string"
      ? windows
        ? [shell, "/d", "/s", "/c", command]
        : ["/bin/sh", "-c", command]
      : command.length === 0
        ? windows
          ? [shell]
          : [shell, "-l"]
        : command;

  let term: IPty;

  try {
    term = pty.spawn(file ?? shell, args, {
      name: "xterm-256color",
      cols: options.size.columns,
      rows: options.size.rows,
      cwd: options.cwd,
      env: terminalEnv(options.env),
    });
  } catch (error) {
    throw new SdkError(
      "unavailable",
      `Cannot start ${file ?? shell} in a pty: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const encoder = new TextEncoder();
  let marker: string | null = null;
  let line = "";
  let quietSince = 0;

  term.onData((text) => {
    log.push(encoder.encode(text));
    quietSince = Date.now();

    marker = lastMarker(text) ?? marker;
    const plain = withoutEscapes(text);
    const broken = plain.lastIndexOf("\n");
    line = (broken < 0 ? line + plain : plain.slice(broken + 1)).slice(-1024);
    const returned = line.replace(/\r+$/, "").lastIndexOf("\r");

    if (returned >= 0) line = line.slice(returned + 1);
  });
  term.onExit(({ exitCode, signal }) => finish(signal ? null : exitCode));
  log.throttle({ pause: () => term.pause(), resume: () => term.resume() });

  return {
    pty: true,
    async write(bytes) {
      term.write(Buffer.from(bytes));
    },
    resize(size) {
      term.resize(size.columns, size.rows);

      return true;
    },
    idle() {
      if (marker !== null) return marker !== "C";

      return quietSince > 0 && Date.now() - quietSince >= QUIET_MS && line.trim() !== "";
    },
    kill(signal) {
      try {
        term.kill(windows ? undefined : signal);
      } catch {}
    },
  };
}

function lastMarker(text: string): string | null {
  return Array.from(text.matchAll(PROMPT_MARKER), (match) => match[1]).at(-1) ?? null;
}

function withoutEscapes(text: string): string {
  let plain = "";
  let at = 0;

  while (at < text.length) {
    const char = text[at] ?? "";

    if (char !== ESC) {
      plain += char;
      at += 1;
      continue;
    }

    const kind = text[at + 1] ?? "";
    at += 2;

    if (kind === "[") {
      while (at < text.length && !/[@-~]/.test(text[at] ?? "")) at += 1;
      at += 1;
    } else if (kind === "]") {
      while (at < text.length && text[at] !== BEL && !(text[at] === ESC && text[at + 1] === "\\"))
        at += 1;
      at += text[at] === BEL ? 1 : 2;
    }
  }

  return plain;
}

function loadPty(): PtyModule | null {
  if (loaded === undefined)
    loaded = ptyFrom(() => createRequire(import.meta.url)("@lydell/node-pty"));

  return loaded;
}

function ptyFrom(load: () => unknown): PtyModule | null {
  try {
    const required = load();

    return fitsPtyModule(required) ? required : null;
  } catch {
    return null;
  }
}

/** Whether a required module exports `spawn`, as `@lydell/node-pty` does. */
// oxlint-disable-next-line nyte-code/no-one-off-boolean-helpers -- a guard: inlined, the check narrows `spawn` to Function, not to the module's typed signature
function fitsPtyModule(value: unknown): value is PtyModule {
  return (
    typeof value === "object" &&
    value !== null &&
    "spawn" in value &&
    typeof value.spawn === "function"
  );
}

function waitEnd(ended: Promise<JobEnd>, request: RequestOptions | undefined): Promise<JobEnd> {
  const signal = request?.signal;

  if (signal === undefined) return ended;

  if (signal.aborted) return Promise.reject(new SdkError("unavailable", "aborted"));

  return new Promise((settled, failed) => {
    const abort = (): void => failed(new SdkError("unavailable", "aborted"));
    signal.addEventListener("abort", abort, { once: true });
    ended.then((end) => {
      signal.removeEventListener("abort", abort);
      settled(end);
    }, failed);
  });
}

type OutputLog = {
  push(bytes: Uint8Array, stream?: "stderr"): void;
  end(code: number | null): void;
  reader(): { next(): Promise<IteratorResult<OutputFrame>>; close(): void };
  /** Pauses the source while the slowest reader is `PAUSE_BYTES` behind, until it is back within `RESUME_BYTES`. */
  throttle(source: { pause(): void; resume(): void }): void;
};

/** `log`, timing its output as the `pty.output` span of `trace` from the first byte to the exit while tracing is on. */
function tracedOutput(log: OutputLog, trace: string | null): OutputLog {
  if (!tracing.enabled) return log;
  let ended: EndSpan | null = null;
  let bytes = 0;

  return {
    ...log,
    push(chunk, stream) {
      ended ??= startSpan("pty.output", trace);
      bytes += chunk.byteLength;
      log.push(chunk, stream);
    },
    end(code) {
      ended?.({ bytes, code });
      log.end(code);
    },
  };
}

/** A process's output kept for its readers: the last `limit` bytes, a reader that falls further behind skipping to a gap. */
function createOutputLog(limit: number): OutputLog {
  const state: {
    readonly chunks: Extract<OutputFrame, { readonly kind: "bytes" }>[];
    first: number;
    size: number;
    pushed: number;
    exit: { readonly code: number | null } | null;
  } = { chunks: [], first: 0, size: 0, pushed: 0, exit: null };

  const waiters = new Set<() => void>();
  const positions = new Set<{ read: number }>();
  let source: { pause(): void; resume(): void } | null = null;
  let paused = false;

  const behind = (): number =>
    Math.max(0, ...[...positions].map((position) => state.pushed - position.read));

  const pace = (): void => {
    if (source === null) return;
    const lag = behind();

    if (!paused && lag > PAUSE_BYTES) {
      paused = true;
      source.pause();
    } else if (paused && lag < RESUME_BYTES) {
      paused = false;
      source.resume();
    }
  };

  const wake = (): void => {
    const pending = [...waiters];
    waiters.clear();

    for (const resolve of pending) resolve();
  };

  return {
    throttle(next) {
      source = next;
    },
    push(bytes, stream) {
      state.chunks.push(
        stream === undefined
          ? { kind: "bytes", data: bytes }
          : { kind: "bytes", data: bytes, stream },
      );
      state.size += bytes.byteLength;
      state.pushed += bytes.byteLength;

      while (state.size > limit && state.chunks.length > 1) {
        state.size -= state.chunks.shift()?.data.byteLength ?? 0;
        state.first += 1;
      }

      pace();
      wake();
    },
    end(code) {
      state.exit ??= { code };
      wake();
    },
    reader() {
      let cursor = 0;
      let done = false;
      let waiting: (() => void) | null = null;
      const position = { read: 0 };
      positions.add(position);

      return {
        async next() {
          for (;;) {
            if (done) return DONE;

            if (cursor < state.first) {
              cursor = state.first;
              position.read = state.pushed - state.size;

              return { done: false, value: { kind: "gap" } };
            }

            const chunk = state.chunks[cursor - state.first];

            if (chunk !== undefined) {
              cursor += 1;
              position.read += chunk.data.byteLength;
              pace();

              return { done: false, value: chunk };
            }

            if (state.exit !== null) {
              done = true;

              return { done: false, value: { kind: "exit", code: state.exit.code } };
            }

            await new Promise<void>((woken) => {
              waiting = woken;
              waiters.add(woken);
            });
            waiting = null;
          }
        },
        close() {
          done = true;
          positions.delete(position);
          pace();
          const resolve = waiting;
          waiting = null;

          if (resolve !== null) {
            waiters.delete(resolve);
            resolve();
          }
        },
      };
    },
  };
}
