import type { EnvironmentProvider } from "@nyte-ai/core";

/** Returns the local environment provider (`kind: "local"`): a folder on this machine. `inspect` answers a `{ kind: "local", path }` target's `folderIdentity`, `available` when the path is a readable directory (else `unavailable { unreachable }`; any other target kind `unavailable { unsupported }`), and the project sources present under it, relative to it (`.nyte/plugins/*`, `.nyte/skills`, `.nyte/prompts`, `.nyte/SYSTEM.md`, `.nyte/APPEND_SYSTEM.md`, `.agents/skills`, `AGENTS.override.md`, `AGENTS.md`, `CLAUDE.md`). `attach` resolves the real path and returns an `ExecutionEnv` with that identity, `cwd` the real path, `files` from `localFiles` (with `ripgrep` and `formatter`), `exec` from `localExec`, and a `close` that ends its watchers and the jobs' readers, leaving running jobs alone. `git` is `localGit` (with `git`), `snapshots` is `localSnapshots` storing tree walks under `<home>/.nyte/snapshots` (`home` default `os.homedir()`); no `browser` (the desktop wraps one in); `destroy` rejects with `SdkError("unavailable")`: a local folder is never torn down. */
export function localProvider(options?: {
  readonly home?: string;
  readonly git?: string;
  readonly ripgrep?: string;
  readonly formatter?: string;
}): EnvironmentProvider {
  throw new Error("not implemented");
}
