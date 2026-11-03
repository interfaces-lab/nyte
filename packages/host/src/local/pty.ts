import { createRequire } from "node:module";
import type { IPty, IPtyForkOptions } from "@lydell/node-pty";

export type Pty = {
  readonly pid: number;
  write(bytes: Uint8Array): void;
  resize(columns: number, rows: number): void;
  kill(signal: NodeJS.Signals | undefined): void;
};

export type PtyOptions = {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly columns: number;
  readonly rows: number;
  readonly data: (text: string) => void;
  readonly exit: (code: number | null) => void;
};

export type SpawnPty = (file: string, args: readonly string[], options: PtyOptions) => Pty;

type NodePtyModule = {
  spawn(file: string, args: string[] | string, options: IPtyForkOptions): IPty;
};

type BunTerminal = {
  write(data: Uint8Array): number;
  resize(columns: number, rows: number): void;
  close(): void;
};

type BunSubprocess = {
  readonly pid: number;
  readonly terminal: BunTerminal | undefined;
  readonly exited: Promise<number>;
  readonly signalCode: string | null;
  kill(signal?: string): void;
};

type BunRuntime = {
  spawn(
    command: string[],
    options: {
      readonly cwd: string;
      readonly env: NodeJS.ProcessEnv;
      readonly terminal: {
        readonly cols: number;
        readonly rows: number;
        readonly name: string;
        data(terminal: BunTerminal, data: Uint8Array): void;
      };
    },
  ): BunSubprocess;
};

let loaded: SpawnPty | null | undefined;

export function loadPty(): SpawnPty | null {
  if (loaded === undefined)
    loaded =
      "bun" in process.versions
        ? bunPty(Object.getOwnPropertyDescriptor(globalThis, "Bun")?.value)
        : nodePty(() => createRequire(import.meta.url)("@lydell/node-pty"));

  return loaded;
}

export function nodePty(load: () => unknown): SpawnPty | null {
  const pty = requirePty(load);

  if (pty === null) return null;

  return (file, args, options) => {
    const term = pty.spawn(file, [...args], {
      name: "xterm-256color",
      cols: options.columns,
      rows: options.rows,
      cwd: options.cwd,
      env: options.env,
    });

    term.onData(options.data);
    term.onExit((end) => options.exit(end.signal ? null : end.exitCode));

    return {
      pid: term.pid,
      write: (bytes) => term.write(Buffer.from(bytes)),
      resize: (columns, rows) => term.resize(columns, rows),
      kill: (signal) => term.kill(signal),
    };
  };
}

function bunPty(runtime: unknown): SpawnPty | null {
  if (!fitsBunRuntime(runtime)) return null;

  return (file, args, options) => {
    const decoder = new TextDecoder();

    const child = runtime.spawn([file, ...args], {
      cwd: options.cwd,
      env: options.env,
      terminal: {
        cols: options.columns,
        rows: options.rows,
        name: "xterm-256color",
        data: (_terminal, bytes) => options.data(decoder.decode(bytes, { stream: true })),
      },
    });

    const terminal = child.terminal;

    if (terminal === undefined) throw new Error("Bun opened no terminal.");
    void child.exited.then((code) => {
      options.data(decoder.decode());
      terminal.close();
      options.exit(child.signalCode === null ? code : null);
    });

    return {
      pid: child.pid,
      write: (bytes) => void terminal.write(bytes),
      resize: (columns, rows) => terminal.resize(columns, rows),
      kill: (signal) => child.kill(signal),
    };
  };
}

function requirePty(load: () => unknown): NodePtyModule | null {
  try {
    const required = load();

    return fitsNodePtyModule(required) ? required : null;
  } catch {
    return null;
  }
}

/** Whether a required module exports `spawn`, as `@lydell/node-pty` does. */
// oxlint-disable-next-line nyte-code/no-one-off-boolean-helpers -- a guard: inlined, the check narrows `spawn` to Function, not to the module's typed signature
function fitsNodePtyModule(value: unknown): value is NodePtyModule {
  return (
    typeof value === "object" &&
    value !== null &&
    "spawn" in value &&
    typeof value.spawn === "function"
  );
}

// oxlint-disable-next-line nyte-code/no-one-off-boolean-helpers -- a guard: inlined, the check narrows `spawn` to Function, not to Bun's typed signature
function fitsBunRuntime(value: unknown): value is BunRuntime {
  return (
    typeof value === "object" &&
    value !== null &&
    "spawn" in value &&
    typeof value.spawn === "function"
  );
}
