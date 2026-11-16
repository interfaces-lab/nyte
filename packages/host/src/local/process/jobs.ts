import { spawn } from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { createRequire } from "node:module";
import { basename, isAbsolute, resolve } from "node:path";
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
import { findExecutable, killTree, run, spawnCommand } from "./command.ts";
import { identifyProcess } from "./machine.ts";
import { prepareShellIntegration } from "./shell-integration/index.ts";

type PtyModule = {
  spawn(file: string, args: string[] | string, options: IPtyForkOptions): IPty;
};

type Driver = {
  write(bytes: Uint8Array): Promise<void>;
  resize(size: { readonly columns: number; readonly rows: number }): boolean;
  idle(): boolean | Promise<boolean>;
  kill(signal: NodeJS.Signals): void;
  readonly pty: boolean;
  readonly pid: number | undefined;
};

const OUTPUT_LIMIT = 1024 * 1024;

const PAUSE_BYTES = 256 * 1024;

const RESUME_BYTES = 64 * 1024;

const STOP_GRACE_MS = 2_000;

const CLOSE_GRACE_MS = 2_000;

const DONE = { done: true, value: undefined } as const;

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

    const loginShell = typeof command !== "string" && command.length === 0;

    if (loginShell && input?.pty === undefined)
      throw new SdkError("invalid", "An empty command runs only in a pty, as the login shell.");
    const cwd = input?.cwd === undefined ? root : resolve(root, input.cwd);
    const shell = options?.shell?.() ?? undefined;

    if (!loginShell || !isAbsolute(shell ?? process.env.SHELL ?? "")) await processEnvironment();
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
        : await terminal(command, { cwd, env, size: input.pty, shell, load }, log, finish);

    spawned();
    const os = driver.pid === undefined ? null : await identifyProcess(driver.pid);

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
      ...(os === null ? {} : { os }),
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
      idle: async () => driver.pty && (finished !== null || driver.idle()),
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
  let killed = false;
  child.on("close", (code) => finish(killed ? null : code));
  child.on("exit", (code) => {
    setTimeout(() => {
      child.stdout?.destroy();
      child.stderr?.destroy();
      finish(killed ? null : code);
    }, CLOSE_GRACE_MS).unref();
  });

  return {
    pty: false,
    pid: child.pid,
    async write(bytes) {
      const stdin = child.stdin;

      if (stdin === null || !stdin.writable)
        throw new SdkError("unavailable", "The process no longer reads its input.");
      await new Promise<void>((written) => stdin.write(bytes, () => written()));
    },
    resize: () => false,
    idle: () => false,
    kill(signal) {
      if (windows) {
        killed = true;
        killTree(child, signal);

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
    readonly load: () => PtyModule;
  },
  log: OutputLog,
  finish: (code: number | null) => void,
): Promise<Driver> {
  const pty = options.load();
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

  const loginShell = typeof command !== "string" && command.length === 0;

  const integration = await prepareShellIntegration({
    file: file ?? shell,
    args,
    env: terminalEnv(options.env),
    loginShell,
  });

  let term: IPty;

  try {
    term = pty.spawn(file ?? shell, [...integration.args], {
      name: "xterm-256color",
      cols: options.size.columns,
      rows: options.size.rows,
      cwd: options.cwd,
      env: integration.env,
    });
  } catch (error) {
    integration.dispose();
    throw new SdkError(
      "unavailable",
      `Cannot start ${file ?? shell} in a pty: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const encoder = new TextEncoder();

  const show = (text: string): void => {
    if (text !== "") log.push(encoder.encode(text));
  };

  term.onData((text) => show(integration.read(text)));
  term.onExit(({ exitCode, signal }) => {
    show(integration.end());
    integration.dispose();
    finish(signal ? null : exitCode);
  });
  log.throttle({ pause: () => term.pause(), resume: () => term.resume() });

  return {
    pty: true,
    pid: term.pid,
    async write(bytes) {
      term.write(Buffer.from(bytes));
    },
    resize(size) {
      term.resize(size.columns, size.rows);

      return true;
    },
    async idle() {
      if (!loginShell) return false;
      const reported = integration.state();
      const running = reported.kind === "running";
      const children = running || (reported.kind === "prompt" && reported.jobs > 0);

      const result = await run(
        windows ? "powershell.exe" : "ps",
        windows
          ? [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              `Get-CimInstance Win32_Process -Filter "ParentProcessId = ${term.pid} AND Name != 'conhost.exe' AND Name != 'OpenConsole.exe'" | Select-Object -ExpandProperty ProcessId`,
            ]
          : ["-A", "-o", "pid=,ppid=,pgid=,stat=,comm="],
        { cwd: options.cwd, timeoutMs: 1_500 },
      );

      if (result.code !== 0) throw new SdkError("unavailable", "Cannot inspect terminal processes");
      const processes = result.stdout.toString("utf8").trim();

      if (windows) return processes === "";

      return !processes.split("\n").some((line) => {
        const [id, parent, group, state, ...name] = line.trim().split(/\s+/);

        if (state?.startsWith("Z")) return false;

        if (Number(parent) === term.pid) return children || Number(group) !== term.pid;

        return (
          Number(id) === term.pid &&
          ((running && state?.startsWith("R") === true) ||
            basename(name.join(" ")).replace(/^-/, "") !== basename(shell))
        );
      });
    },
    kill(signal) {
      try {
        if (!windows && signal === "SIGKILL") process.kill(-term.pid, signal);
        else term.kill(windows ? undefined : signal);
      } catch {}
    },
  };
}

function loadPty(): PtyModule {
  if ("bun" in process.versions)
    throw new SdkError(
      "unavailable",
      "Terminals need the Nyte desktop app's host: this host can't run @lydell/node-pty.",
    );
  return ptyFrom(() => createRequire(import.meta.url)("@lydell/node-pty"));
}

function ptyFrom(load: () => unknown): PtyModule {
  try {
    const required = load();

    if (fitsPtyModule(required)) return required;
  } catch (cause) {
    throw ptyUnavailable(cause instanceof Error ? cause.message.split("\n", 1)[0] : String(cause));
  }
  throw ptyUnavailable("it exports no spawn");
}

function ptyUnavailable(reason: string): SdkError {
  return new SdkError(
    "unavailable",
    `Terminals need @lydell/node-pty, which did not load: ${reason}`,
  );
}

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
  throttle(source: { pause(): void; resume(): void }): void;
};

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
