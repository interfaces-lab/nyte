import type { ExecutionEnv } from "@nyte-ai/core";

/** Returns `exec` for a folder: each call starts one process as a `Job` (a fresh id; `key` null, core keys pty jobs) in `cwd` resolved against `root` (default `root`), with `env` laid over `process.env`. A string command runs through the platform shell (`/bin/sh -c`, `cmd.exe /d /s /c` on Windows) and an argv directly; `[]` with `pty` runs the login shell (`shell`, else `$SHELL`, else `/bin/sh`, as a login shell; §37h). Without `pty` the process is piped through `node:child_process`, stdout and stderr interleaved in `output` and stdin fed by `write`; with `pty` it runs under `@lydell/node-pty` at the given size. `output()` opens a reader over a bounded buffer that yields `bytes`, a `gap` where the reader fell behind (the process never stalls), and `exit { code }` last. `resize` resizes a pty (`not-pty` for a pipe); `idle` answers whether a pty's shell sits at a prompt by its OSC 133 prompt markers (false for a pipe, and before any marker); `stop` sends SIGTERM to the process group, SIGKILL after 5 s, and answers `settled { outcome }` (also once it ended); `settled` resolves `exited { code, reason }`, `reason` `exited` when the process ended on its own and `terminated` after `stop` or an aborted `signal`; `close` detaches this handle's readers. An aborted `signal` stops the process. */
export function localExec(
  root: string,
  options?: { readonly shell?: string },
): ExecutionEnv["exec"] {
  throw new Error("not implemented");
}
