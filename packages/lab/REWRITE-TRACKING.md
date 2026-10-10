# Rewrite tracking

One entry per work order, in execution order. The main agent fills in the exact
exports and files before assigning, ticks boxes from subagent reports, and
never from memory. Status: `[ ]` not started · `[~]` in progress · `[x]` passed review.

Each entry has two phases, declare then implement, each with its own review.

## core-a — Store, events, errors

**Baseline:** §7 Store · §8 Events · `SdkError` · §0 `Schema`, `standard()` adapter

| phase | status |
|---|---|
| declare | [ ] |
| implement | [ ] |

**Deliverables**

- [ ] `Store`, `StoreConnection`, `ObjectStore`, `RefStore`, `Ref`, `RefUpdate`, `SetOutcome`
- [ ] `DurableEvent`, `SessionEvent`, `PatchEvent`, `CommitBody`
- [ ] `SdkError`, `SdkErrorCode`, `ValidationIssue`
- [ ] `Schema<T>`, `Infer<S>`, `standard(schema)` in `@nyte-ai/schema`
- [ ] a memory `Store` for tests and bench
- [ ] refs `host/identity`, `sessions/<id>/leases/<head>` (decision 3)

**Notes**

- `@nyte-ai/schema` root = baseline records; `/model` = provider-facing (decision 1)
- `ai` imports move to `/model`

**Deletes** (old surface → baseline)

| | old | baseline |
|---|---|---|
| [ ] | `Result<S, F>, .ok / .value` | acquisition throws; commands return one outcome. |
| [ ] | `Nyte.open().sdk, Nyte.connect().sdk` | the thing you hold is the Sdk. |
| [ ] | `ResourceInput<T> owned/borrowed` | pass the object; the caller owns what it made. |
| [ ] | `JournalProfile` | journal?: RequestJournal. |
| [ ] | `KeyFactory / sdk.keys.*` | minted inside, returned on receipts. |
| [ ] | `queueAndSettle chain` | receipt.settled(). |
| [ ] | `AdmittedInput / InputHandle split` | SendReceipt. |
| [ ] | `Operation<T> { status, settled, stop }` | Receipt<T>; the same handle send returns. SubmissionKey vs CommandKey identity spaces ReceiptId; one space, one lookup: session.receipt(id). |
| [ ] | `OperationsDirectory.find({ kind, key })` | session.receipt(id). |
| [ ] | `head.input(key), PendingInputs, withdraw()` | receipt.stop() before landing. |
| [ ] | `HistoryReader as Owned, renew(), expiresAt, renewableUntil, snapshot-expired` | tree() is a paged read. |
| [ ] | `HistoryRetentionPolicy, maxReaders, capacity failure` | no GC leases; abandoned history retained until prune. |
| [ ] | `markSeen(), SeenMark, SeenOutcome, unseen: CommitId | null, convergent recovery class` | refs/seen/<principal>/<head>, advanced by watch(). |
| [ ] | `HostAdminApi, "administration" authority` | authority lives on each operation declaration. |
| [ ] | `sdk.administration.machine()` | sdk.models (providers, credentials, limits in one) and sdk.settings. |
| [ ] | `sdk.providers, sdk.usage, ModelDirectory, provider.status, host.accountLimits, ProviderCatalogView, UsageApi` | ModelsApi. A provider is a credential plus its models plus its limits. |
| [ ] | `Capability<> on providers/settings/usage` | per-operation authority answers denied; Capability is for environment provision only. ContextStatus { estimated, usage, trailing } ContextView { tokens, window, percent, lastRequest }. |
| [ ] | `Model<Api>, thinkingLevelMap, streamFn` | never cross the sdk; ModelInfo.thinking lists what the picker shows. |
| [ ] | `admin.reactivate()` | gone with trust; workspace.reload() re-activates after a failure. |
| [ ] | `admin.warming.modeChanged()` | sdk.settings.apply(); core owns the value. |
| [ ] | `admin.relocate()` | session.update({ workspace }). |
| [ ] | `admin.retention` | host.prune(). |
| [ ] | `HostUnsafe.withStore / withLease` | @nyte-ai/core exports for driver authors. |
| [ ] | `WorkspaceTrustMode ask|always|never` | a client preference for whether it shows a dialog before add; core never reads it. |
| [ ] | `requires/workspace_trust { cwd }, ActivationRequirement, reactivate()` | activation has no consent state. Activation: active | inactive | unavailable | failed. |
| [ ] | `consent { hostId, identity } client-side` | add({ expect: { identity } }) checked by core. |
| [ ] | `TrustPrompt / declined set` | client plugin; a policy that gates tool calls is a core plugin on before_tool. |
| [ ] | `head.events(), SessionEvent union,` | watch() twins on session, sessions, sdk, workspace, git, files, jobs. |
| [ ] | `sessions.metadata, sessionCwd, sessionRoot` | session.info() carries workspace, parent, heads, configuration. cacheWarming.status, cache_warming_decision, prompt-cache warming is a plugin: after_request for timing, a model |
| [ ] | `SendOptions.history / HistoryEpoch` | expect: revision is the one guard. |
| [ ] | `environment.loginAttempt / answerLogin,` | providers.login() is a stream; the attempt lives as long as its iterator. |
| [ ] | `LoginAttemptHandle, attempt(id) reacquire` | Login.steps(); an attempt does not survive a reload. |
| [ ] | `HostUnsafe.withStore / withLease` | core exports for store drivers; the Store interface is the contract. |
| [ ] | `web/pins.ts, repair flag, consent snapshot` | connect({ expect: { hostId } }); stale throws; the client re-asks. |
| [ ] | `ChangesApi, ChangeBase, ChangeRead` | files.batch(), git.changes(scope) and workspace.changes(run). |
| [ ] | `GuardedGit, git.at(revision)` | expect? on each git write. |
| [ ] | `GuardedPage, page.at(revision), expectedName on click/type` | expect? on click/type; stale outcome. |
| [ ] | `PageOwner session | workspace` | a page is a workspace resource; a tool's hold shows in background. |
| [ ] | `browser.destroy(id)` | close() on the last hold; policy reclaims. |
| [ ] | `AcquisitionKey minted by the caller` | Terminal.key on the receipt; recover(key). |
| [ ] | `PtyOwner / PtyView ownership discriminant` | Terminal extends TerminalView; the type is the ownership. |
| [ ] | `files.save / FileWriteResult partial` | files.write; partial only on batch. |
| [ ] | `files.bytes({ expect })` | bytes(path); the reader carries the version it read. |
| [ ] | `files.blame` | git.blame. |
| [ ] | `GitScope run` | workspace.changes(run) / patches(run): environment snapshots, not git. |
| [ ] | `jobs.start({ session }) required, job ends with session / tab / client` | session optional; a job is a workspace process that outlives the chat. |
| [ ] | `job vs terminal as separate things` | Job.terminal; a pty-backed job attaches as a terminal view. |
| [ ] | `ConfigurationReceipt { key, revision }` | ConfigureOutcome; configure is an outcome, not a receipt. |
| [ ] | `Failure redeclared` | the schema's Failure. Withdrawal { withdrawn | landed | uncertain } receipt.stop() answers requested | settled; landed() says what happened. |
| [ ] | `HistoryReader as Owned, pages(), renew(),` | tree() is one projected read with a revision; core walks the DAG, the |
| [ ] | `HistoryNode.imports, client projectTree()` | client draws rows. The /tree picker is how a session is navigated. |
| [ ] | `JobsApi on session, job.background()` | workspace.jobs; background is the absence of a wait. |
| [ ] | `sessions.find(id)` | session(id).info(). |
| [ ] | `sdk.catalog(), CatalogView` | HostView.operations. |
| [ ] | `part.state(), job.info(), Job.terminal` | reads are the view and jobs.list/watch; a handle has no I/O fields. |
| [ ] | `run.restore(), runs.revert, RestoreResult` | no restore. Snapshots serve diffs only. Capability<T> on files/git/browser/terminals kept; it reports provision, not existence. |
| [ ] | `NyteHost / NyteConnection wrappers` | Host / Connection extend Sdk. |
| [ ] | `ConnectOptions.transport union, ipc` | url. |
| [ ] | `settings.apply(id, choice: string)` | apply(id, value: Json) against the setting's schema; numbers, text, lists. |

**Exports, files, imports:** filled in by the main agent before assignment.

**Open questions:** none. (Append to REWRITE-DECISIONS.md, numbered.)

## core-b — Fold and view

**Baseline:** §2c SessionView, Message, TurnInfo, Execution, BackgroundItem · delta guarantees · `ViewOptions`, `history`

| phase | status |
|---|---|
| declare | [ ] |
| implement | [ ] |

**Deliverables**

- [ ] `SessionView`, `Message`, `UserStatus`, `PartStatus`, `Schedule`, `TurnInfo`, `Execution`, `BackgroundItem`, `ContextView`, `Usage`
- [ ] the fold: `(view, event) → view`, structurally shared, one per session per connection
- [ ] coalescing: one yield per frame, newest wins
- [ ] `Head.view(options)`, `Head.watch(options)`, `Head.history()`
- [ ] `Sessions.watch({ limit })`, `Connection.watch()` → `HostView`

**Notes**

- `SessionView.seq` does not exist

**Deletes** (old surface → baseline)

| | old | baseline |
|---|---|---|
| [ ] | `observe(), SessionObservation, subscribe / getSnapshot` | watch(). |
| [ ] | `parts.list()` | view.parts for non-transcript placements. |
| [ ] | `SessionSnapshot.transcript: Turn[] + parts` | view.messages: Message[]; turn is a field, not a container. |
| [ ] | `Shell / Exec separate from jobs` | ExecutionEnv.exec returns a Job; every process is a job. |
| [ ] | `sdk.events(), HostEventFrame` | The delta stream is internal to watch(); the durable log is host.inspect().events(). |
| [ ] | `events "fact" / "synced" / "status_changed"` | settings and status are data on views, not signals. |
| [ ] | `ParkedCall / parked[]` | tool state waiting { on } and execution waiting. |
| [ ] | `TurnToolClass guessed in the client` | ToolClass declared on Tool.define. |
| [ ] | `changesFromTurns()` | tool part state.changes from the run's recorded snapshots. |
| [ ] | `TurnPart assistant | thinking | tool unions` | built-in part kinds text | thinking | tool; one Message shape. |
| [ ] | `turns() / mergeAdjacentThinking() helpers` | no construction functions from core; data is precomputed, the client buckets in O(n). |
| [ ] | `ExecutionView "waiting" phase as a spinner` | execution.waiting: WaitTarget; background: list. |
| [ ] | `RunView.phase, RunInfo.abortRequested` | Execution carries phase; RunView.stopping. |
| [ ] | `runs.current, run.info(), RunRecord` | the view embeds RunView; print mode reads settled()'s RunEnd. |
| [ ] | `pending.revise(), outbox row edit` | send(content, { replace }) chosen by the message's status. |

**Exports, files, imports:** filled in by the main agent before assignment.

**Open questions:** none. (Append to REWRITE-DECISIONS.md, numbered.)

## core-c — Admission, runs, receipts, history refs

**Baseline:** §2 Head, Session, Sessions · `send` with every delivery and `replace` · stop fence · `Receipt`, `SendReceipt` · `tree`, `move`, `heads.*`, `compact`, `configure`

| phase | status |
|---|---|
| declare | [ ] |
| implement | [ ] |

**Deliverables**

- [ ] `Connection`, `Host` (minus listen), `Sessions`, `Session`, `Head`, `Run`, `Receipt<O>`, `SendReceipt`, `StopOutcome<O>`
- [ ] `Configuration`, `ConfigurationPatch`, `MessageSource`, `Delivery`, `UserContent`, `Position`, `TreeView`, `TreeNode`
- [ ] every outcome union in §2
- [ ] child report delivery: attach or wake, exactly one
- [ ] reserved principals `local`, `token` (decision 4)

**Notes**

- `sessions.create` throws for an unknown workspace

**Deletes** (old surface → baseline)

| | old | baseline |
|---|---|---|
| [ ] | `steer() / queue()` | send(content, { delivery }). |
| [ ] | `Session.parent on the handle, heads(), children(), head.context(), run.changes()` | info() and view; a handle binds with no I/O. PluginCommandResult prompt relayed by client core sends a command's prompt itself, source action. |
| [ ] | `edit(), EditInput, EditOutcome` | send(content, { replace }) for landed; the same call revises pending and rewrites unsent. |
| [ ] | `navigate(), NavigateInput, handback` | move(position, options). |
| [ ] | `branch(), BranchOutcome { head }` | head(name).create(); you already hold the handle. |
| [ ] | `SideHeadHandle, SideHeadName` | one Head; is-main is an outcome. |
| [ ] | `DelegationApi, ChildAgent, ChildTaskObservation, ChildObservation, join(), waitMs on every call` | sessions.create({ parent }) + send + settled + wait. |
| [ ] | `DeliveryJournal, sdk.deliveries` | the user message's unsent status in the view. |
| [ ] | `messages.redeliver({ before })` | send({ replace, position }). |
| [ ] | `CommandSelection run | insert` | derived: arguments null → run on pick; a schema → collect first. |
| [ ] | `Command.run(argument: string)` | arguments?: Schema<Args>; a text command is Schema<string>. |
| [ ] | `SettingInfo.choices + current: string` | schema + value: Json; choices only decorate enums. ApplySettingOutcome not_found/invalid_choice SettingOutcome applied | invalid { issues } | unknown. |
| [ ] | `AdmissionRecord, InputLanding` | the user message: delivery, status.pending.placement, status.landed.replaced. |
| [ ] | `CompactResult / CompactOutcome` | the compaction part's status; compact() says started | busy | nothing. |
| [ ] | `RunChanges, ExactRunChanges, "recorded" / "missing" evidence kinds` | workspace.changes(run); snapshots are an environment obligation, so evidence is never missing where files are. |

**Exports, files, imports:** filled in by the main agent before assignment.

**Open questions:** none. (Append to REWRITE-DECISIONS.md, numbered.)

## core-d — Parts

**Baseline:** §2b PartDefinition, Part, Placement, ActOutcome · built-ins `text`, `thinking`, `tool`, `compaction`, `branchSummary` · `definePart`, `isPart`

| phase | status |
|---|---|
| declare | [ ] |
| implement | [ ] |

**Deliverables**

- [ ] `PartDefinition`, `ActionSchemas`, `ActionOutput`, `ActionContext`, `Part`, `ActOutcome`, `Placement`, `PartView`
- [ ] `definePart`, `isPart`, the five built-ins with `fallback`
- [ ] ownerless parts: no `onAction` → `act` settles `answer()` (decision 2 / council #9)
- [ ] `session.parts.create({ id })` recorded when called from a durable step

**Deletes** (old surface → baseline)

| | old | baseline |
|---|---|---|
| [ ] | `api.ui.dialog, Dialog<Answer>` | a plugin-declared modal part + part.answer() / wait({ kind: "part" }). |
| [ ] | `wait({ kind: "question" }), run.reply, ParkedWait.reason.question, Selection` | a modal part; an action settles it. |
| [ ] | `question as a built-in part kind` | no. Core asks nothing; harness/desktop/tui ship an ask plugin if they want one. |
| [ ] | `contribute.panels / status / decorations` | parts; "panel" and "status" are placement strings a client knows, not core types. |
| [ ] | `"core asks nothing" vs 5 s decide hooks` | a core decide hook is Durable: it may park on a modal part. |

**Exports, files, imports:** filled in by the main agent before assignment.

**Open questions:** none. (Append to REWRITE-DECISIONS.md, numbered.)

## core-e — Durability and tools

**Baseline:** §4 ToolInvocation, Durable, ToolDefinition, ToolResult, ToolOutcome, ToolProgress, ToolClass, WaitTarget, WaitOutcome · replay, memo, recorded acquisitions, nested calls, interrupted

| phase | status |
|---|---|
| declare | [ ] |
| implement | [ ] |

**Deliverables**

- [ ] `Durable` shared by tools, actions, core decide hooks
- [ ] `ToolInvocation` with `env`, `tools.execute/activate/list`, `progress`
- [ ] `ToolDefinition` with `exposure`, `namespace`, `grammar`, `class`, `replay`
- [ ] intent-before / result-after recording; crash → replay or `interrupted`
- [ ] `WaitTarget` any/all/deadline/untilInput

**Exports, files, imports:** filled in by the main agent before assignment.

**Open questions:** none. (Append to REWRITE-DECISIONS.md, numbered.)

## core-f — Plugins, hooks, resources, workspaces, model request

**Baseline:** §5 core side · §4b EnvironmentProvider, ExecutionEnv · §4c-bis Resources · §4d api.request · §3 Workspaces, Workspace · §3b Jobs, FilesApi, GitApi, BrowserApi

| phase | status |
|---|---|
| declare | [ ] |
| implement | [ ] |

**Deliverables**

- [ ] `Plugin<"core">`, `PluginApi<"core">`, registries, `RegistryDraft`, hook dispatch with phases and budgets, `report`, `reload`
- [ ] `EnvironmentProvider`, `ExecutionEnv`, `EnvironmentWrap`, `Capability<T>`
- [ ] `Resources` scan: `~/.nyte`, `.nyte`, `~/.agents/skills`, `.agents/skills`, ancestor `AGENTS.md`; `Resources.user` from the local provider (decision 9)
- [ ] `Workspaces`, `Workspace`, `Jobs`, `Job`, `FilesApi`, `GitApi`, `BrowserApi`, `ChangeSet`, `PatchSet`, `Hunk` interfaces and core-side wrapping (`upload`, `batch().apply()` receipts, `patches` batching and cache)
- [ ] `api.request()`, `ModelRequestInput`, `ModelRequestOutcome`
- [ ] `PluginStorage` with `at(scope)` and `secrets` (decision 10)
- [ ] built-in plugins (decision 13): `system-prompt`, `environment`, `resources`, `delegation`, `parts`
- [ ] `Host.plugins.replace/check`, `Host.prune`, `Host.principals`, `Host.inspect`, `Host.execution`

**Deletes** (old surface → baseline)

| | old | baseline |
|---|---|---|
| [ ] | `Agent.system layered only` | prompt { layer | replace }; a role may own the whole prompt. |
| [ ] | `api.rebuild()` | api.reload(): it feels like a hot reload of what the plugin offers. |
| [ ] | `Revision as a type of its own` | view.revision, the opaque token every expect? takes. |
| [ ] | `UserContent text | image` | text | file (any mime) | reference; the model filters by ModelInfo.input. |

**Exports, files, imports:** filled in by the main agent before assignment.

**Open questions:** none. (Append to REWRITE-DECISIONS.md, numbered.)

## protocol — Declaration table and generated artifacts

**Baseline:** §1 Declaration, declarations · §6 wire rules · decision 7 encoding

| phase | status |
|---|---|
| declare | [ ] |
| implement | [ ] |

**Deliverables**

- [ ] `Declaration`, `Authority`, the `declarations` table covering every served operation
- [ ] generated: routes (`POST /<name>`), codecs, SSE framing with `id: <seq>`, octet-stream for `stream` kinds and byte inputs, `HostView.operations` catalog
- [ ] `SdkError` serialisation, strict-in lenient-out

**Deletes** (old surface → baseline)

| | old | baseline |
|---|---|---|
| [ ] | `workspace.vcs.* protocol namespace` | git. |
| [ ] | `workspace.current / select` | no host-global selection; every handle is bound to an id. |
| [ ] | `workspace.files(query) mention list` | files.find(query). |
| [ ] | `vcs.diff(paths ≤ MAX) as a client contract` | the limit is the sdk's batching detail, not a caller's. |
| [ ] | `VcsSnapshot + vcs.changes as two reads` | status() and changes(scope); both watchable. |

**Exports, files, imports:** filled in by the main agent before assignment.

**Open questions:** none. (Append to REWRITE-DECISIONS.md, numbered.)

## host — listen, stores, drivers, providers, bench driver

**Baseline:** §1 ListenOptions, Listener · §7 implementations · §4c drivers · §4b providers · `packages/bench/README.md`

| phase | status |
|---|---|
| declare | [ ] |
| implement | [ ] |

**Deliverables**

- [ ] `listen` with `http | fetch`, `auth`, authority gating from the table
- [ ] stores: sqlite, postgres, durable object
- [ ] execution drivers: local loop, Cloudflare alarms, Vercel workflows; `host/deploy/*` configs
- [ ] providers: local (git CLI, hidden-ref snapshots, pty jobs, `~/.nyte`), sandbox, chat-only
- [ ] secrets key composition (decision 10); `~/.nyte/settings.json` seed (decision 12)
- [ ] `@nyte-ai/host/bench`: `BenchDriver` per `packages/bench/README.md`

**Deletes** (old surface → baseline)

| | old | baseline |
|---|---|---|
| [ ] | `HostOpenFailure, ConnectionFailure, ResourceOpenFailure, RequestFailure, MutationFailure, AdmissionFailure, ...` | thrown. |
| [ ] | `HostOpenOptions (17 fields)` | OpenOptions (4 + execution). |
| [ ] | `ServerPermissions operation allowlist` | Authority on each declaration; authorize names the principal's set. |
| [ ] | `ServingPolicy, OperationDeclaration { authority, execution, recovery } unions` | Declaration { input, output, kind, authority, scope, capability?, recovery? }. |
| [ ] | `NyteServerOptions.environment, permissions` | workspaces and resources are declarations with authority owner. |
| [ ] | `OperationFn<"workspace.vcs.diff"> remote` | generated from declarations; the Sdk shape is the client. |
| [ ] | `RemoteNyte / RemoteSessions / Remote*` | one Sdk type for local and remote. |
| [ ] | `NyteOptions.trust callback, WorkspaceTrust` | no trust state. add() is the consent; projectResources is the one fact. |
| [ ] | `HostOptions.resolveWorkspace,` | workspaces.inspect/add; the record lives in core's store. WorkspaceStore + workspaces.json |
| [ ] | `EnvironmentProvider provision/suspend/open` | inspect / attach / destroy; git, snapshots, browser, terminals as optional supplies. |
| [ ] | `"git on every host"` | wrong layer. Git is per environment; unsupported stays possible for a no-filesystem environment. |

**Exports, files, imports:** filled in by the main agent before assignment.

**Open questions:** none. (Append to REWRITE-DECISIONS.md, numbered.)

## sdk — open, connect, client, journal

**Baseline:** §1 entry · `RequestJournal`, `JournalEntry`, `CredentialSource` · the client-side fold

| phase | status |
|---|---|
| declare | [ ] |
| implement | [ ] |

**Deliverables**

- [ ] `sdk.open`, `sdk.connect` with `expect.hostId`, `Connection.credential` (decision 11)
- [ ] the typed client generated from the table; handles bind synchronously
- [ ] the journal: memory default, adapter optional; resend by id
- [ ] the same fold as core-b, running on the client; resume from `Last-Event-ID`
- [ ] runs in Node, browsers, React Native

**Notes**

- add `"@nyte-ai/sdk": "workspace:*"` and `"@nyte-ai/host": "workspace:*"` to `packages/bench`

**Exports, files, imports:** filled in by the main agent before assignment.

**Open questions:** none. (Append to REWRITE-DECISIONS.md, numbered.)

## plugin — Plugin types and every plugin

**Baseline:** §5 · `/core`, `/client` subpaths · the sixteen plugins fresh

| phase | status |
|---|---|
| declare | [ ] |
| implement | [ ] |

**Deliverables**

- [ ] `Plugin<Side>`, `PluginApi<Side>`, `ContributionTable`, `HookTable`, `Renderer`, `ClientApi`; re-exports of `definePart`, `isPart`, built-ins
- [ ] plugins: question, notifications, rename, bash-description, web-search, codemode, mcp, openai-compaction, openai-astra-context, telemetry, canvas, reviewer, browser-tools, and the desktop/tui/web renderers

**Deletes** (old surface → baseline)

| | old | baseline |
|---|---|---|
| [ ] | `PluginSession { info, rename, context }` | PluginApi<"core">.session is the full Session. |
| [ ] | `SessionApi vs client plugin interfaces` | one Plugin<Side>; subpath export fixes the side. |
| [ ] | `refresh(), defer(), PluginEvents` | a registry write schedules the rebuild; api.session.watch(). |
| [ ] | `HookMap, hand-written Owns<S>` | ContributionTable / HookTable rows; Available<> derives the rest. |
| [ ] | `TSchema / typebox at the plugin boundary` | Schema<T> = StandardSchemaV1 & StandardJSONSchemaV1. |
| [ ] | `admin.session(id) diagnostics` | host.inspect(id). |
| [ ] | `WorkspaceTrust.plugins / changes closures` | core loads project resources through the environment provider. |
| [ ] | `CacheWarmingPlan, NyteOptions.cacheWarming` | request for the warm. Core decides nothing about caches. NyteOptions.telemetry / onDiagnostic / drain a telemetry plugin on after_request; summary failures are run failures; drain is kernel policy. |
| [ ] | `diagnostics.notify (bell from core)` | no. Core asks and alerts nothing; a client plugin on a hook may. |
| [ ] | `host.pluginSources.invalidate` | workspace.reload(). |
| [ ] | `ToolRun.tools.execute / activate, onUpdate` | invocation.tools.execute / activate, invocation.progress. |
| [ ] | `createPlugin()` | satisfies Plugin; the subpath fixes the side. |
| [ ] | `ToolResult.text only` | content: text | file; images from read, screenshots, MCP. |
| [ ] | `memo() around every parts/sessions.create` | acquisitions through a durable step are recorded by key. |
| [ ] | `refresh() deleted outright` | api.rebuild() for external state; writes still schedule one. |
| [ ] | `deferred?: boolean` | exposure: model | deferred | code | hidden; namespace; grammar. |
| [ ] | `Registry.add → Disposer for settings` | add() returns the Setting handle; the plugin reads and watches it. |
| [ ] | `Plugin.uses` | composition is spreading contribute and calling activate. |
| [ ] | `no plugin model call` | api.models.request(): one non-turn request, charged to the session. |
| [ ] | `skills plugin reading .agents itself` | api.inputs: core scans ~/.nyte, .nyte, ~/.agents/skills, .agents/skills, ancestor |
| [ ] | `session.plugins namespace, PluginReadApi, commands.list, settings.list, skills(), plugins.catalog, plugins.resources,` | view.catalog, watched; session.command() the one write. |

**Exports, files, imports:** filled in by the main agent before assignment.

**Open questions:** none. (Append to REWRITE-DECISIONS.md, numbered.)

## clients — app, desktop, tui, cli, mobile, docs

**Baseline:** consumers of the sdk only

| phase | status |
|---|---|
| declare | [ ] |
| implement | [ ] |

**Deliverables**

- [ ] `app`: screens over `watch()`; one component per message by `partKind`; the compact step window from `turn.state`/`turn.steps`
- [ ] `desktop`: Electron shell, `open`, `wrapEnv` viewport browser, `connect` relay, mounts `app`
- [ ] `tui`: over the sdk; the tree picker over `head.tree()`
- [ ] `cli`: `nyte -p` via `receipt.settled()`, `nyte serve` via `open` + `listen`
- [ ] `mobile`: React Native over the sdk
- [ ] `docs/content/docs/kernel` from the baseline

**Deletes** (old surface → baseline)

| | old | baseline |
|---|---|---|
| [ ] | `serve attaching() wrapper` | listen execution.coverage default: sessions this listener serves. |
| [ ] | `host.trustWorkspace IPC, --trust flag` | workspaces.add(); --trust is add without the client dialog. |
| [ ] | `tui trust-dialog.ts, app open-workspace` | a client dialog around inspect → add, optional. The desktop may ship one as a |
| [ ] | `registry.ts "only an admin can trust"` | authority "owner" on inspect/add/update/forget. |
| [ ] | `PendingItem, OutboxRow, OutboxRowState` | Message { kind: "user", state: unsent | pending | landed }. |
| [ ] | `LivePart, LiveParts, LiveSnapshot, live-fold.ts, livePartKey()` | Message { kind: "part", status: live | waiting | settled | failed }. |
| [ ] | `conversationMessages(), represented set, landing:${key} row id trick` | the sdk folds; ids are stable across states. |
| [ ] | `durableChanged(), snapshot cache split` | one view, structurally shared. SessionView.transient { completeness, parts } the live tail is in messages with state. |
| [ ] | `Turn.kind "config"` | configuration on the view and on RunView. |
| [ ] | `Turn.kind "checkpoint" / "summary"` | built-in parts compaction and branchSummary, role note. |
| [ ] | `MachineApi.github, host.github.*` | a core plugin the harness ships: commands github/pr.create, a status part. Not SDK. |
| [ ] | `host.browser.find/downloads/login/history` | browser chrome stays in the desktop viewport adapter. fonts, openExternal, revealPath, contextMenu, native shell IPC is not SDK. updates.*, setThemePreference |
| [ ] | `host.remote.*, host.connect.* device lists` | host.principals.pair / revoke; tunnels and relays are listen transports. |
| [ ] | `ClientSide desktop | tui, SideTable.view` | Side is core | client; a Renderer declares its framework, the client mounts what it can. |
| [ ] | `@nyte-ai/client package, createLogin,` | no client package. sdk handles and watch() are the primitives; |
| [ ] | `ConnectOptions.transport http | ipc` | url; the relay is a URL with a pairing credential. |
| [ ] | `outbox-storage.ts, use-outbox.ts, OutboxRow` | RequestJournal in the sdk; the user message's unsent status in the view. |
| [ ] | `live.ts react(), rebase invalidation,` | nothing to invalidate: no side caches, every read is watchable. |
| [ ] | `changes-patches.ts PatchSource/Snapshot, READ_BATCH / PINNED_BATCH, key/lineage` | git.patches(scope, paths): batching, revision cache, stale-until-fresh in the sdk. |
| [ ] | `patch-parse.worker.ts, @pierre/diffs parse` | hunks parsed once on the host; the client maps in O(lines). |
| [ ] | `step-group-presentation.ts,` | view.turns: TurnInfo computed by the fold. |
| [ ] | `createThinkingKey(), turnPartId()` | message ids are stable; a part's id is the same live and settled. |
| [ ] | `settings.apply on a session` | configure({ settings }); one door. |
| [ ] | `SessionObserver, outbox, useX hooks` | an app wraps an iterator in its own store. |
| [ ] | `SessionObserver reconnect / rebase` | watch() resumes from seq; a guarantee, not client code. |
| [ ] | `SessionObserver rebase → fresh snapshot` | watch() yields a new view; structural sharing says what changed. |

**Exports, files, imports:** filled in by the main agent before assignment.

**Open questions:** none. (Append to REWRITE-DECISIONS.md, numbered.)
