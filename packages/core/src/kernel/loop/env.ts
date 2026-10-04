/**
 * Where a tool call acts: one filesystem and the shell that runs in it. The
 * kernel hands one to every call; tools reach files and processes only
 * through it, never through anything captured when they were built.
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

export interface ExecutionEnv {
  /** Filesystem identity: equal values see the same files at the same paths. */
  readonly fs: string;
  readonly cwd: string;
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
   * `onData`. Resolves the exit code: signal terminations as 128 + signal
   * number, `null` for a command that ended without one. A command stopped by
   * the timeout or the signal rejects with a `ToolError` whose reason is
   * `timeout` or `cancelled`.
   */
  exec(command: string, options: ExecOptions): Promise<{ exitCode: number | null }>;
}
