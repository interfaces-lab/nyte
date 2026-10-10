# Rewrite tracking

Each row is an old surface the rewrite deletes and the baseline construct that
stands in its place. Tick a row when the old thing is gone from the package and
the new one exists. Grouped by the package that owns the deletion; a row may
touch more than one package, in which case it sits with the first in
dependency order.

Status key: `[ ]` not started · `[~]` in progress · `[x]` done

## core

| | old | baseline |
|---|---|---|
| [ ] | `Result<S, F>, .ok / .value` | acquisition throws; commands return one outcome. |
| [ ] | `Nyte.open().sdk, Nyte.connect().sdk` | the thing you hold is the Sdk. |
| [ ] | `ResourceInput<T> owned/borrowed` | pass the object; the caller owns what it made. |
| [ ] | `JournalProfile` | journal?: RequestJournal. |
| [ ] | `KeyFactory / sdk.keys.*` | minted inside, returned on receipts. |
| [ ] | `steer() / queue()` | send(content, { delivery }). |
| [ ] | `observe(), SessionObservation, subscribe / getSnapshot` | watch(). |
| [ ] | `queueAndSettle chain` | receipt.settled(). |
| [ ] | `AdmittedInput / InputHandle split` | SendReceipt. |
| [ ] | `Operation<T> { status, settled, stop }` | Receipt<T>; the same handle send returns. SubmissionKey vs CommandKey identity spaces ReceiptId; one space, one lookup: session.receipt(id). |
| [ ] | `OperationsDirectory.find({ kind, key })` | session.receipt(id). |
| [ ] | `head.input(key), PendingInputs, withdraw()` | receipt.stop() before landing. |
| [ ] | `Session.parent on the handle, heads(), children(), head.context(), run.changes()` | info() and view; a handle binds with no I/O. PluginCommandResult prompt relayed by client core sends a command's prompt itself, source action. |
| [ ] | `parts.list()` | view.parts for non-transcript placements. |
| [ ] | `edit(), EditInput, EditOutcome` | send(content, { replace }) for landed; the same call revises pending and rewrites unsent. |
| [ ] | `navigate(), NavigateInput, handback` | move(position, options). |
| [ ] | `branch(), BranchOutcome { head }` | head(name).create(); you already hold the handle. |
| [ ] | `SideHeadHandle, SideHeadName` | one Head; is-main is an outcome. |
| [ ] | `HistoryReader as Owned, renew(), expiresAt, renewableUntil, snapshot-expired` | tree() is a paged read. |
| [ ] | `HistoryRetentionPolicy, maxReaders, capacity failure` | no GC leases; abandoned history retained until prune. |
| [ ] | `markSeen(), SeenMark, SeenOutcome, unseen: CommitId | null, convergent recovery class` | refs/seen/<principal>/<head>, advanced by watch(). |
| [ ] | `DelegationApi, ChildAgent, ChildTaskObservation, ChildObservation, join(), waitMs on every call` | sessions.create({ parent }) + send + settled + wait. |
| [ ] | `api.ui.dialog, Dialog<Answer>` | a plugin-declared modal part + part.answer() / wait({ kind: "part" }). |
| [ ] | `wait({ kind: "question" }), run.reply, ParkedWait.reason.question, Selection` | a modal part; an action settles it. |
| [ ] | `question as a built-in part kind` | no. Core asks nothing; harness/desktop/tui ship an ask plugin if they want one. |
| [ ] | `contribute.panels / status / decorations` | parts; "panel" and "status" are placement strings a client knows, not core types. |
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
| [ ] | `SessionSnapshot.transcript: Turn[] + parts` | view.messages: Message[]; turn is a field, not a container. |
| [ ] | `head.events(), SessionEvent union,` | watch() twins on session, sessions, sdk, workspace, git, files, jobs. |
| [ ] | `sessions.metadata, sessionCwd, sessionRoot` | session.info() carries workspace, parent, heads, configuration. cacheWarming.status, cache_warming_decision, prompt-cache warming is a plugin: after_request for timing, a model |
| [ ] | `DeliveryJournal, sdk.deliveries` | the user message's unsent status in the view. |
| [ ] | `SendOptions.history / HistoryEpoch` | expect: revision is the one guard. |
| [ ] | `messages.redeliver({ before })` | send({ replace, position }). |
| [ ] | `environment.loginAttempt / answerLogin,` | providers.login() is a stream; the attempt lives as long as its iterator. |
| [ ] | `LoginAttemptHandle, attempt(id) reacquire` | Login.steps(); an attempt does not survive a reload. |
| [ ] | `"core asks nothing" vs 5 s decide hooks` | a core decide hook is Durable: it may park on a modal part. |
| [ ] | `Agent.system layered only` | prompt { layer | replace }; a role may own the whole prompt. |
| [ ] | `api.rebuild()` | api.reload(): it feels like a hot reload of what the plugin offers. |
| [ ] | `` | AGENTS.md (pi's list under .nyte, plus the agentskills.io convention); plugins add more. Stores.sqlite / postgres / from / cloudflare one Store interface; the caller constructs and owns it. |
| [ ] | `Shell / Exec separate from jobs` | ExecutionEnv.exec returns a Job; every process is a job. |
| [ ] | `HostUnsafe.withStore / withLease` | core exports for store drivers; the Store interface is the contract. |
| [ ] | `web/pins.ts, repair flag, consent snapshot` | connect({ expect: { hostId } }); stale throws; the client re-asks. |
| [ ] | `sdk.events(), HostEventFrame` | The delta stream is internal to watch(); the durable log is host.inspect().events(). |
| [ ] | `events "fact" / "synced" / "status_changed"` | settings and status are data on views, not signals. |
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
| [ ] | `ParkedCall / parked[]` | tool state waiting { on } and execution waiting. |
| [ ] | `TurnToolClass guessed in the client` | ToolClass declared on Tool.define. |
| [ ] | `changesFromTurns()` | tool part state.changes from the run's recorded snapshots. |
| [ ] | `TurnPart assistant | thinking | tool unions` | built-in part kinds text | thinking | tool; one Message shape. |
| [ ] | `turns() / mergeAdjacentThinking() helpers` | no construction functions from core; data is precomputed, the client buckets in O(n). |
| [ ] | `CommandSelection run | insert` | derived: arguments null → run on pick; a schema → collect first. |
| [ ] | `Command.run(argument: string)` | arguments?: Schema<Args>; a text command is Schema<string>. |
| [ ] | `SettingInfo.choices + current: string` | schema + value: Json; choices only decorate enums. ApplySettingOutcome not_found/invalid_choice SettingOutcome applied | invalid { issues } | unknown. |
| [ ] | `ConfigurationReceipt { key, revision }` | ConfigureOutcome; configure is an outcome, not a receipt. |
| [ ] | `AdmissionRecord, InputLanding` | the user message: delivery, status.pending.placement, status.landed.replaced. |
| [ ] | `CompactResult / CompactOutcome` | the compaction part's status; compact() says started | busy | nothing. |
| [ ] | `Failure redeclared` | the schema's Failure. Withdrawal { withdrawn | landed | uncertain } receipt.stop() answers requested | settled; landed() says what happened. |
| [ ] | `HistoryReader as Owned, pages(), renew(),` | tree() is one projected read with a revision; core walks the DAG, the |
| [ ] | `HistoryNode.imports, client projectTree()` | client draws rows. The /tree picker is how a session is navigated. |
| [ ] | `Revision as a type of its own` | view.revision, the opaque token every expect? takes. |
| [ ] | `UserContent text | image` | text | file (any mime) | reference; the model filters by ModelInfo.input. |
| [ ] | `JobsApi on session, job.background()` | workspace.jobs; background is the absence of a wait. |
| [ ] | `ExecutionView "waiting" phase as a spinner` | execution.waiting: WaitTarget; background: list. |
| [ ] | `RunView.phase, RunInfo.abortRequested` | Execution carries phase; RunView.stopping. |
| [ ] | `runs.current, run.info(), RunRecord` | the view embeds RunView; print mode reads settled()'s RunEnd. |
| [ ] | `sessions.find(id)` | session(id).info(). |
| [ ] | `sdk.catalog(), CatalogView` | HostView.operations. |
| [ ] | `part.state(), job.info(), Job.terminal` | reads are the view and jobs.list/watch; a handle has no I/O fields. |
| [ ] | `RunChanges, ExactRunChanges, "recorded" / "missing" evidence kinds` | workspace.changes(run); snapshots are an environment obligation, so evidence is never missing where files are. |
| [ ] | `run.restore(), runs.revert, RestoreResult` | no restore. Snapshots serve diffs only. Capability<T> on files/git/browser/terminals kept; it reports provision, not existence. |
| [ ] | `NyteHost / NyteConnection wrappers` | Host / Connection extend Sdk. |
| [ ] | `ConnectOptions.transport union, ipc` | url. |
| [ ] | `pending.revise(), outbox row edit` | send(content, { replace }) chosen by the message's status. |
| [ ] | `settings.apply(id, choice: string)` | apply(id, value: Json) against the setting's schema; numbers, text, lists. |

## protocol

| | old | baseline |
|---|---|---|
| [ ] | `workspace.vcs.* protocol namespace` | git. |
| [ ] | `workspace.current / select` | no host-global selection; every handle is bound to an id. |
| [ ] | `workspace.files(query) mention list` | files.find(query). |
| [ ] | `vcs.diff(paths ≤ MAX) as a client contract` | the limit is the sdk's batching detail, not a caller's. |
| [ ] | `VcsSnapshot + vcs.changes as two reads` | status() and changes(scope); both watchable. |

## host

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

## plugin

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

## clients

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
