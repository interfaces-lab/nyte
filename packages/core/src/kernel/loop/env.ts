/**
 * Where a tool call acts: one environment's files, paths, and the shell that
 * runs in it. The kernel hands one to every call; tools reach files and
 * processes only through it, never through anything captured when they were
 * built.
 */

export type FileKind = "file" | "directory" | "other";

export interface FileInfo {
  readonly kind: FileKind;
}

export interface ExecOptions {
  readonly onData: (data: Buffer) => void;
  readonly signal?: AbortSignal;
  /** Seconds. */
  readonly timeout?: number;
}

/** What an environment does. A wrap sees and returns these, never the environment's identity. */
export interface EnvOps {
  /**
   * The absolute path `paths` name here, each resolved against the one before
   * it and the first against `cwd`. The first may be a path a person typed,
   * read the way this environment reads one.
   */
  resolve(...paths: string[]): string;
  readFile(path: string): Promise<Buffer>;
  writeFile(path: string, content: string): Promise<void>;
  /** Creates missing parents. */
  mkdir(path: string): Promise<void>;
  /** `undefined` when nothing is at `path`. Follows symlinks. */
  stat(path: string): Promise<FileInfo | undefined>;
  readdir(path: string): Promise<string[]>;
  /** The path with symlinks resolved; `undefined` when nothing is at `path`. */
  realpath(path: string): Promise<string | undefined>;
  /**
   * Run a shell command in `cwd`, streaming combined stdout and stderr to
   * `onData`. Resolves the exit code; a signal termination is 128 + the signal
   * number. A command stopped by the timeout rejects with a `ToolError` whose
   * reason is `timeout`; one stopped by the signal, with the signal's stop
   * reason: `cancelled`, or `interrupted` when the abort names none.
   */
  exec(command: string, options: ExecOptions): Promise<{ exitCode: number }>;
}

/** An environment: its operations, and the identity no wrap changes. */
export interface ExecutionEnv extends EnvOps {
  /** The environment's id: equal ids see the same files at the same paths. Compared exactly. */
  readonly id: string;
  readonly cwd: string;
}
