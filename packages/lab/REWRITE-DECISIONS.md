# Rewrite decisions

Answers to what the baseline was silent on, asked by the core (a) work order.
Each answer is binding; where it changes a signature, the baseline carries the
change and this file points at it. Numbered as asked.

## Blocking before core (a)

**1. Name collisions in `@nyte-ai/schema`.** The schema root exports the
baseline's names (`Message`, `Usage`, `ToolCall`, every view and outcome). The
provider-facing records (`Message`, `ToolCall`, `Model<Api>`, `Usage` as the
provider reports it) move to the subpath `@nyte-ai/schema/model`. `ai` changes
its imports to `/model` and nothing else; that is within "untouched except
`Models`". The baseline's `ModelMessage` import reads
`import type { Message as ModelMessage } from "@nyte-ai/schema/model"`.
`Usage` is one type on the root: the baseline's definition is the provider's
record with `cost` added by core at request settlement.

**2. Where parts live.** `definePart`, `isPart`, `PartDefinition`, `Part`,
`Placement` and the built-ins `text`, `thinking`, `tool`, `compaction`,
`branchSummary` are core exports. `@nyte-ai/plugin/core` re-exports
`definePart`, `isPart` and the built-in definitions; `@nyte-ai/plugin/client`
re-exports `isPart` and the built-in definitions (a renderer imports the kind
it draws). Nothing else from core crosses into plugin.

**3. Host identity and leases.** Two refs join the table:
`host/identity` → `{ id: HostId, createdAt }`, written once on first open and
never moved; `sessions/<id>/leases/<head>` → `{ holder: HostId, expiresAt }`,
the execution lease `execution.cover` takes and `advance` renews, CAS'd like
every ref. `AdvanceReport.fenced` is the lease CAS answering `stale`.

**4. In-process principal.** `open` connects as `PrincipalId("local")` with
every authority. A token principal is `PrincipalId("token")` with
`participant` + `owner`. A paired device is its own id from `principals.pair`.
`"local"` and `"token"` are reserved; `pair` never mints them.

**5. `OpenOptions.workspace`.** `open` registers it as `addedBy: "local"`,
`projectResources: true`, with `expect` unset (the owner starting the host is the
consent). If it is already registered, `exists`. It becomes the default for
`sessions.create` without `workspace`.

## Blocking before protocol / host

**6. Relay.** Not a transport and not in host. The listener's `fetch` is the
primitive; a relay adapter dials the broker outbound with the desktop's
account-enrolled device identity (a signing key, not a `CredentialSource`)
and forwards each frame to `listener.fetch`; the broker's signed assertion of
account and device is what `auth: { kind: "custom", authorize }` reads to
name the principal. That adapter is the `connect` package, which stays as the
broker contract and the desktop-side dialer, and lives in the desktop, the
only thing that enrolls. `connect-worker` is unchanged. The package map's
"fold `connect` into host" is withdrawn. A phone connects with `url` = the
broker's address for that host and `credentials: { kind: "custom" }` carrying
its account session.

**7. Wire encoding.** Fixed, not negotiable per deployment:

- Every declaration is `POST /<name>` with the input as a JSON body and the
  output as a JSON body. The name is the declaration key (`session.send`).
  Handles are not on the wire: the input carries the ids (`session`, `head`,
  `run`, …) the handle bound.
- `watch` kind: `text/event-stream`. The session watch streams
  `SessionEvent | PatchEvent` frames with `id: <seq>` on durable ones; the sdk
  folds. Every other watch (host, directory, workspace, git, jobs, page)
  streams whole views, coalesced the same way; they are small by construction.
  Resume is `Last-Event-ID`.
- `stream` kind (`bytes`, `capture`, `blob`, `output`): `application/octet-stream`
  response, chunked. `job.output` frames `gap` and `exit` as a trailing JSON
  line after a zero-length chunk; the sdk reconstructs `OutputFrame`.
- Resources that carry bytes (`files.write`, `job.write`, `upload`,
  `batch().put` with contents): `application/octet-stream` body, and the JSON
  input in the `X-Nyte-Input` header, base64url. One shape for all four.
- `fetch` transport is identical; it is the same handler without a socket.

**8. Mobile.** It stays TypeScript (Expo) and imports `@nyte-ai/sdk`, which
must therefore run in React Native: no Node, `fetch` and `EventSource` only,
the journal over AsyncStorage. There is no Swift generation. The catalog on
`HostView.operations` is JSON with JSON Schemas for any non-TS client that
appears later; nothing in this rewrite consumes it. The package map row for
`mobile` is corrected to say this.

**9. `Resources.user`.** The person's `.nyte` is on the host machine, and
the host machine is the local provider's machine by construction. Core
attaches the registered `"local"` provider at the home's `.nyte` and that is
`Resources.user`; no local provider (a durable object) → `null`. A session
whose tools run in a sandbox still gets its owner's skills, because the
resources come from the host, not from the session's environment. No option
on `open`; core still touches no filesystem except through an `ExecutionEnv`.

**10. Secrets key.** `OpenOptions.secrets?: { key(): Promise<Uint8Array> }`.
Core encrypts secret values with it before `objects.put` and never logs or
serves them. The host composes the default: OS keychain where there is one,
else `~/.nyte/secret.key` created `0600`. A durable-object host passes its
binding. Omitted = `secrets.set` answers `unavailable`.

**11. Pairing credential.** `{ kind: "pairing"; code }` is exchanged once at
`connect`; the device token it yields is exposed as `Connection.credential`
(a `{ kind: "token" }` source) for the client to persist in its own storage
and pass next time. The sdk keeps it in memory only. The journal stays
sends-only.

**12. `~/.nyte/settings.json`.** `{ [settingId: string]: Json }`, read once on
first `open`, written never. Unknown ids are reported as warnings on
`HostView.plugins[].issues` under a `settings` owner.

**13. Built-ins.** `open` always loads these core plugins, in this order:

| plugin | contributes |
|---|---|
| `system-prompt` | prompt sections `system-prompt` (0), `tools` (1), `rules` (2), `docs` (3) |
| `environment` | prompt section `cwd`; the `read`, `write`, `edit`, `list`, `bash` tools (`ToolClass` read / edit / edit / list / shell) |
| `inputs` | prompt sections `project-context` (10), `skills` (90); skills from `Resources` |
| `delegation` | tools `task`, `create`, `send`, `await`, `read`, `stop` (`ToolClass.delegate` with the matching role) |
| `parts` | the built-in part definitions and their fallback renderers |

Codemode, MCP, web search, question, notifications, telemetry are plugins the
harness or a user installs; none is built in.

**14. Homes.** The telemetry plugin is `packages/plugin/src/telemetry.ts`.
Cloudflare and Vercel deployment configs (wrangler, `vercel.json`, the worker
entry) move to `packages/host/deploy/cloudflare` and `packages/host/deploy/vercel`.

## Decided by the header, confirmed

Store and driver interfaces, `EnvironmentProvider` and `ExecutionEnv` are core
exports. `Declaration` is a schema record and `declarations` is protocol's.
Core wraps a provider's files to supply `upload` and `batch().apply()`
receipts. Jobs are in-memory and lost on restart; `JobView.state.lost` is how
a client learns it. Undefined names are proposed by the work order that first
reaches them. Docs live at `packages/docs/content/docs/kernel`. `demo` and
`lab/src` do not compile at root until the end.

## Flagged for the owner

Three of the above are product calls I made so the rewrite is unblocked; say
the word and they change:

- **8**: mobile stays TS on the sdk (vs. a native client of the catalog).
- **10**: secrets key from the OS keychain with a file fallback (vs. file only).
- **13**: the built-in set, especially that delegation and the five fs tools
  are built in while codemode is not.

## Vocabulary, settled

Names the baseline uses on purpose; do not propose alternatives for these.

| word | means | not |
|---|---|---|
| `Configuration` | a run's resolved selection: model, thinking, agent, settings, `settingsVersion`; carries `kind: "exact"` | "choice" |
| `ConfigurationPatch` | the partial form a caller passes: omit = keep, value = set, `null` = clear the override. Data, not an action; "patch" is the file's word for this omit/set/null shape, as in `session.update(patch)` and `workspace.update(patch)` | `Partial<Configuration>` (that would promise the wrong thing about `null`) |
| `Resources` | what core scanned from the person's and the project's `.nyte` and the `.agents` convention: skills, prompts, context files, `SYSTEM.md` | "inputs" |
| `projectResources` | whether the project's own code runs | "projectInput", "trust" |
| `Submission` | the `before_send` payload | "UserInput" |
| `MessageSource` | who sent a message: user, child, job, shell, action | "InputSource" |
| `Schedule` | where an admitted message was placed: joined, next-turn, attached | "InputPlacement" |
| `input` | a tool's, an action's or a declaration's arguments. Nothing else. | |
| `Placement` | where a part shows: transcript, modal, or any string a client knows | |
| `receipt` | the handle for durable work: send, move, batch | "operation" |
| `job` | the one process primitive; a pty job is a terminal | "terminal" as a separate thing |
| `reload` | `PluginApi.reload()`: re-derive what a plugin offers; `Workspace.reload()`: re-read project resources | "rebuild", "refresh" |

## Since the core (a) questions

Changes to the baseline after the fourteen answers, so a work order written
against an earlier read is corrected here:

- Relay transport withdrawn (decision 6 rewritten). `ListenOptions.transport`
  is `http | fetch`; `connect` stays as the desktop-side relay over
  `listener.fetch`.
- `EnvironmentProvider.user` and `OpenOptions.inputs` withdrawn (decision 9
  rewritten). `Resources.user` is the `"local"` provider attached at `~/.nyte`,
  or `null`.
- `OpenOptions.secrets`, `Connection.credential`, `host/identity` and
  `sessions/<id>/leases/<head>` refs stand.
- `Inputs` → `Resources`; `projectInput` → `projectResources`; `UserInput` →
  `Submission`; `InputSource` → `MessageSource`; `InputSchedule` → `Schedule`;
  `ChoicePatch` → `ConfigurationPatch`; `ResolvedChoice` → `Configuration`;
  the `Choice` / `InputChoice` union is gone, fields are typed
  `Configuration | ConfigurationPatch` and narrow on `"kind" in value`.
- `ModelMessage` imports from `@nyte-ai/schema/model`.
- Job and terminal are one primitive: `jobs.start({ pty })`, `Job.key`,
  `jobs.recover(key)`, `Job.resize`, `Job.idle`, `Job.close` detaches, `Job.stop`
  ends. `TerminalsApi`, `Terminal`, `TerminalAttachment` do not exist.
- `view(options)` / `watch(options)` take `ViewOptions { tail }`;
  `head.history({ before, limit })` pages back. `SessionView.seq` is gone.
- `connection.blob(id)` reads an attachment. `HostView.authority` says what
  the connected principal may do.
- `ToolPartState` is phased: `calling | running { progress } | settled { outcome, changes }`.
- `TurnInfo.summary.byClass` is keyed by `ToolClass["kind"]`.
- `Registry<T, S, Handle>` and `Command<Args, S>` carry the side.
- `Declaration.capability` derives from `EnvironmentProvider`'s keys.
- `packages/bench` exists; the host work order delivers `@nyte-ai/host/bench`
  per its README. It carries no workspace dependency until `@nyte-ai/sdk` lands.

Start from the baseline as it is now; this list is why a sentence in an older
work order may no longer match.
