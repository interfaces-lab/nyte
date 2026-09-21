# @nyte-ai/host

One composition of a `Nyte` for every Nyte host. Core stays the kernel; this
package owns the choices a host makes on top of it: the model catalog that
answers, the plugins that load and from where, and what a workspace must have
granted before project code runs. The TUI, the desktop, and a server all
compose through it.

```ts
import { createNyteModels } from "@nyte-ai/ai";
import { SqliteStore } from "@nyte-ai/core/store";
import { createHost, resolveModel } from "@nyte-ai/host";
import { createNyteServer } from "@nyte-ai/server";

const models = createNyteModels();
const nyte = await createHost({
  models,
  model: await resolveModel(models, "anthropic/claude-opus-5"),
  store: new SqliteStore("./nyte.db"),
  plugins: { kind: "chat", system: "You are…" },
});
nyte.attach();
export default {
  fetch: createNyteServer({ sdk: nyte, version: "1.0.0", auth: { kind: "token", token } }).fetch,
};
```

`HostOptions` is `NyteOptions` minus what the host derives: `models` supplies
both the catalog and the stream function, and `plugins` names a mode instead of
a plugin list. The caller opens the store and closes it after `nyte.close()`.

## Plugin modes

- `chat`: a system prompt and provider compaction. No filesystem tools, no
  plugin directories, no skills, no trust. `env.cwd` is informational.
- `workspace`: the shared built-ins (`resolveHostPlugins`), then
  `~/.nyte/plugins`, then `<cwd>/.nyte/plugins`, then skills. `readManifest`
  merges `~/.nyte/nyte.json` and `<cwd>/.nyte/nyte.json`: `plugins` disables
  ids, `mcp` names servers whose tools the `mcp` built-in contributes through
  one process-wide connection pool. `pluginWatchTargets` is what a host
  watches to re-resolve; pass `nyte.holdPlugins` as the watcher's `hold` so
  runners wait for the swap. `target` is `{ kind: "home" }`, `{ kind: "project", workspace }`
  where `workspace` is a `TrustedWorkspace` (only the workspace store makes one), or
  `{ kind: "deferred", resolve }` to open storage now and resolve the target
  when the first session activates. `extra` appends client-specific built-ins.
- `custom`: plugins the caller loaded itself, passed through.

`nyteHome()` is `NYTE_HOME` or `~/.nyte`. `createWorkspaceStore()` names the
file there that every client shares: `workspaces.json`, which records each
workspace's trust grant and when it was last opened.

## Delegated models

A task call may select an exact `provider/model`. When it omits the model, Nyte uses
`openai-codex/gpt-5.6-sol`; when it omits the thinking level, Nyte uses `high`. Users can
request another model or thinking level, and the parent passes that explicit choice for the call.
There is no global subagent setting.

The host checks the resolved selection against `models.getAvailable()` before creating the child.
Provider auth and `filterModels` determine availability. An unavailable explicit choice or default
returns a task error before child creation; Nyte never substitutes another model or provider.

The child config records the resolved model before its prompt runs. Missing or
catalog-blocked ids return a task error without creating a child. Provider errors
not reflected in catalog availability remain request errors, not automatic
model-switch retries.

## Local tool usage

`@nyte-ai/host/usage` exports `readLocalUsage` for desktop and TUI. It reads
Claude Code and Codex local history together, returning independent `claudeCode`
and `codex` results. Each result is `LocalHistoryUsage`: missing, failed, or ready
with token consumption, per-model totals, estimated API cost, and scan warnings.
Usage measures recorded consumption, not subscription limits or remaining quota.
These all-time tool summaries stay separate from Nyte's own totals.

Both clients use the same read and pricing logic. Desktop runs it in its existing
scan worker with persisted file caches; TUI reuses in-memory file caches between
visits to `/usage`. Neither needs a login, credentials, network request, or a CLI
executable on PATH. Closing the TUI panel cancels the scan.

`readCodexUsage` reads `sessions` and `archived_sessions` under explicit `homeDir`,
then nonblank `CODEX_HOME`, then `~/.codex`. `readClaudeCodeUsage` is also available
for callers reading only Claude Code. `readLocalUsage` accepts `models`, an optional
`signal`, and optional `caches` from `createUsageScanCaches()`.

The following details describe the Claude Code reader:

```ts
import type { Models } from "@nyte-ai/ai";
import type { UsageSummary } from "@nyte-ai/client";
import { readClaudeCodeUsage } from "@nyte-ai/host/usage";

// ClaudeCodeUsageOptions
const options: {
  readonly models: Pick<Models, "getModels">;
  readonly configDir?: string;
  readonly signal?: AbortSignal;
} = { models };

// Promise<ClaudeCodeUsage>
const usage = await readClaudeCodeUsage(options);
// { kind: "missing" }
// | { kind: "failed"; message: string }
// | { kind: "ready"; summary: UsageSummary; unpricedRecords: number;
//     malformedRecords: number; unreadableFiles: number }
```

The directory is explicit `configDir`, then nonblank `CLAUDE_CONFIG_DIR`, then
`~/.claude`. Only regular `.jsonl` files beneath its `projects` directory are
read, recursively, including subagents. Child symlink entries are skipped;
the configured root and its ancestors may be symlinks. Nothing executes and no credentials,
authentication, network calls, core sessions, or commits are involved. Optional
scan caches reuse unchanged files. Only the catalog's synchronous
`getModels("anthropic")` is called.

Assistant usage is validated as nonnegative safe integers. The deduplication
key is the `message.id` / `requestId` tuple across files and projects, with
`null` for a missing or blank ID. Records without either ID remain independent. Repeated snapshots keep the
whole largest token total, then largest output on ties, then a reported cost
if only one snapshot has it. Exact ties retain the first snapshot. Timestamps
are not used. This keeps final output rather than the first content block and
does not synthesize a response from unrelated field maxima.

Each summary row uses `provider: "anthropic"`, the recorded model ID, and
`turns` equal to retained record count. Compaction and tool totals stay zero.
The one-hour cache-write count stays a subset of total cache writes. A finite
nonnegative top-level `costUSD` supplies the total without inventing a cost
breakdown. Otherwise one exact Anthropic catalog match supplies a current-rate
estimate through AI's `calculateCost`, including cache TTL and pricing tiers.
No aliases or fuzzy matches are inferred. Zero catalog prices are valid.
Unpriced records keep their tokens and contribute zero cost; their count makes
that omission visible.

An absent directory is `missing`; an empty one is `ready` with zero totals.
Malformed complete records and unreadable files are skipped and counted.
`unreadableFiles` also counts unreadable subdirectories, whose contents cannot
be scanned. Failure to open the projects root returns `failed`. An unparseable
final line without a newline is treated as an in-progress append until the next
scan. A complete final object counts without a newline. Files are streamed only
to their size at open.
Cancellation rejects with the signal's reason and never returns partial totals.

## Workspace search

The host package owns ripgrep discovery and execution. It uses system `rg` 12 or later, then the Nyte cache, otherwise downloads ripgrep 15.1.0 for the current platform. Downloads are checked against pinned SHA-256 digests before extraction. The cache lives at `$NYTE_HOME/bin`, or `~/.nyte/bin` by default. Cancelling one search does not cancel a shared installation; a failed installation can be retried.

`findRipgrepFiles` enumerates eligible files. `grepRipgrep` streams validated JSON matches with UTF-8 byte offsets and takes exactly one source, a directory or text on stdin. Calls disable user ripgrep configuration, use the default non-backtracking regex engine, and bound output. Partial read failures, such as unreadable directories, keep the records ripgrep already produced. No Electron API is required.

The search design follows [OpenCode v2](https://github.com/anomalyco/opencode/tree/0643a5638e0cd02234e73f176771527d7600faf7/packages/core/src/ripgrep). See the [shared third-party notices](../../THIRD-PARTY-NOTICES.md#opencode-anomalycoopencode).

`@nyte-ai/host` owns workspace reads, version-checked saves, and `searchWorkspaceFiles`, as well as filename discovery. Content search owns draft precedence, confinement, strict UTF-8/binary/2 MB file checks, skipped counts, UTF-16 selections, and bounded snippets. Hosts validate requests with `WorkspaceSearchSchema` and add their own cancellation IDs. Desktop only dispatches the parsed request and maps host errors to IPC errors.

Content search keeps Nyte's validated-byte behavior: disk batches use private temporary snapshots, removed after the subprocess closes; drafts use stdin. This differs from OpenCode's direct workspace grep. Removing the snapshots would also require changing validation and skipped-count behavior. Searches are bounded by matches (500 by default, 1,000 at most), 8 MB of subprocess output, and five seconds, excluding binary installation. Regex validation runs even when filters select no files; literal searches need no validation subprocess.

`discoverMentionFiles` and `rankMentionFiles` provide filename discovery. `sdk.workspace.files({ target, query? })` carries that discovery over the wire for clients that cannot read the host's filesystem: `target` selects the current workspace or a session's directory, and the operation answers `rankMentionFiles`' best matches, one menu's worth. Ranking is split by where the list lives: a client holding the whole tree ranks it itself, as Desktop does with prefix and substring buckets; a client that asks per query gets the host's substring ranking and nothing else to keep in sync. Both Desktop and TUI use ripgrep for file discovery; the TUI ranks filenames with `fuzzysort`. There is no native filename index or platform-specific search binding. Home-directory scans exclude hidden files and protected macOS and Windows folders, including when the home path is a symlink. Enumeration is bounded at 100,000 files; mention lists return at most 5,000 entries.

Ripgrep owns ignore-file behavior. Linked ignore files are read but not offered as mention candidates. Directory results are derived from discovered files, so empty directories are not guaranteed.

## Account usage

`readAccountUsage` from `@nyte-ai/host/usage` reads subscription windows for
`anthropic` or `openai-codex` through Nyte's existing model authentication and AI
adapters. It returns `ready` with `AccountLimits`, `unavailable`, or `failed` with a
sanitized message. The caller supplies models, provider, and an abort signal.
Cancellation propagates; timeout produces a failed read. Model-specific windows
are retained, including Claude Fable when reported by the provider.

This read is separate from `readLocalUsage`: it requires a subscription login and
network access and does not contribute token counts or estimated costs. It uses
the account signed into Nyte, not credentials discovered from an external CLI.

## Telemetry export

`@nyte-ai/host/otel` exports `createOtelExport({ serviceName, endpoint? })`.
It is off unless `endpoint` or `NYTE_OTEL_ENDPOINT` is set; on, it batches
core's spans to that OTLP/HTTP traces URL (an origin gets `/v1/traces`
appended). Pass `telemetry` to `createHost`; call `shutdown()` after the host
closes to flush. The provider is private to the export: nothing is registered
globally and no ambient context manager is installed.

```sh
NYTE_OTEL_ENDPOINT=http://127.0.0.1:4318 nyte
```

Any OTLP/HTTP collector works for dogfooding, e.g. `otel-desktop-viewer` or
Jaeger all-in-one.
