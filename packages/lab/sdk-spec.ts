/**
 * Nyte SDK contracts.
 *
 * Proposed, not implemented. One contract for every caller: a local host, a
 * connected client, a plugin tool, a script. No caller kind owns a method,
 * and nothing here is a UI hook.
 *
 * This is an import-free spec, not runnable code. Unresolved names stand for
 * the cited dependencies. No example runs at module load. Results are named so
 * you can comment on the returned value.
 *
 * Notation
 *   field?: T           May be omitted; null requires an explicit union.
 *   field: T|undefined  Required property with a possibly absent value.
 *   field: T|null       Required property; its null meaning is documented.
 *   S                   Synchronous return. Does not imply no I/O.
 *   A                   Await the Promise before using its result.
 *   O                   Check the returned outcome; it is not the receiver.
 *   W / I               Iterate a stream; stop observation with return/abort.
 *   D                   Disposer function.
 *
 * Public = package export. Host-only = local authority, not automatically
 * available to remote clients.
 * Methods do not return their receiver unless stated. Bound handles do not
 * prove existence or own execution. Closing a view does not stop a run.
 * Missing, loading, unsupported and known-empty values remain distinct.
 * Expected failures are Result<Success, Failure>.
 *
 * Shaped by Pierre Code Storage (bind synchronously, await a lookup), Cursor
 * SDK (send is not wait), OpenCode v2 (admission without execution), Pi
 * (steer/followUp, durable submit then wait), Effect (explicit success,
 * failure and requirements; a reference, not a dependency) and Rex (typed
 * actions, strict inputs, lenient reports, a served catalog).
 */

/**
 * Core owns commands, admission, recovery, projection and authorization.
 * The harness supplies storage, model execution, environments, tools and policy.
 * Clients own transport and the pre-receipt journal; views paint data.
 *
 * Use native TypeScript functions, Promises and explicit resource owners.
 * Expected failures return Result<Success, Failure>. Dependencies are ordinary
 * typed parameters where an implementation needs them; there is no required
 * generic handler wrapper, runtime service registry or lazy computation system.
 * Domain schemas define the same operation contract for local, IPC and HTTP calls.
 *
 * API vocabulary
 *   session/head/run/job/workspace/page(id)   S: bind identity, no I/O.
 *   open/connect/create                     A: acquire/create, await first.
 *   steer/queue                             O: host admission, not an answer.
 *   branch                                  O: create a named conversation head.
 *   navigate/edit                           O: admit a durable history operation.
 *   markSeen                                O: forward-only reader mark, not history.
 *   observe/events/bytes                    W: observe; never acquire execution.
 *   stop/withdraw/destroy                   O: explicit durable/lifecycle command.
 *   close/asyncDispose                      A: release exactly the acquired owner.
 *
 * Callers need no observer, outbox, lease or global workspace selection.
 * open/connect permanently binds addresses to the authenticated host. UI
 * selection cannot retarget existing handles or queued requests to another host.
 */

// 1. Usage. One function per operation; the caller kind never changes the call.

// open acquires a host. Its sdk admits input; execution.cover runs it.
async function open(options: HostOpenOptions, task: UserContent, choice: ChoicePatch) {
  const hostResult = await Nyte.open(options);
  if (!hostResult.ok) return hostResult;
  await using host = hostResult.value; // A owned host, no implicit runner.
  const sessionResult = await host.sdk.sessions.create({ name: "Review" });
  if (!sessionResult.ok) return sessionResult;
  const session = sessionResult.value; // Main-head handle plus session operations.
  const coverResult = await host.execution.cover({ kind: "sessions", sessions: [session.id] });
  if (!coverResult.ok) return coverResult;
  await using execution = coverResult.value;
  return await queueAndSettle(session, task, { configuration: choice });
  // Releasing the host stops local driving and closes owned resources, not runs.
}

// connect acquires a client. Binding a session checks nothing until used.
async function connect(options: ConnectOptions, id: SessionId, task: UserContent) {
  const connectedResult = await Nyte.connect(options);
  if (!connectedResult.ok) return connectedResult;
  await using connection = connectedResult.value; // A handshake + owned client.
  const session = connection.sdk.session(id); // S no existence check, no execution claim.
  return await queueAndSettle(session, task, { key: connection.sdk.keys.submission() });
  // Await the settlement before the connection scope disposes.
}

// queue admits; landing places; settled waits for the exact run.
async function queueAndSettle(head: HeadHandle, content: UserContent, options: SubmitOptions) {
  const receiptResult = await head.queue(content, options);
  if (!receiptResult.ok) return receiptResult;
  const receipt = receiptResult.value; // O admission, not an answer.
  if (receipt.record.execution === "uncovered")
    return { ok: true, value: { kind: "uncovered", receipt: receipt.record } } as const;
  const landingResult = await receipt.landing();
  if (!landingResult.ok) return landingResult;
  const landing = landingResult.value; // Await placement, not generation.
  if (landing.kind !== "landed") return landingResult;
  const run = head.run(landing.runId); // S exact run. Several inputs may share it.
  const endResult = await run.settled({ signal: AbortSignal.timeout(30 * 60_000) });
  if (!endResult.ok) return endResult;
  return {
    ok: true,
    value: { kind: "settled", receipt: receipt.record, end: endResult.value },
  } as const;
  // The timeout cancels only this wait. run.stop() is the explicit durable Stop.
}

// branch creates a named head. The head takes every operation main takes.
async function branch(sdk: Sdk, id: SessionId, task: UserContent) {
  const main = sdk.session(id);
  const viewResult = await main.view();
  if (!viewResult.ok) return viewResult;
  const view = viewResult.value; // O addressed lookup can return missing.
  const branchResult = await main.branch({
    name: "review",
    from: view.position,
    key: sdk.keys.command(),
  });
  if (!branchResult.ok) return branchResult;
  const outcome = branchResult.value;
  if (outcome.kind !== "created") return branchResult;
  return await queueAndSettle(outcome.head, task, { key: sdk.keys.submission() });
}

// observe is a stable read model. steer captures the shown history and choice.
async function observeAndSteer(
  sdk: Sdk,
  id: SessionId,
  choice: ChoicePatch,
  prepare: () => Promise<UserContent>,
  paint: (state: SessionObservationState) => void,
) {
  const main = sdk.session(id);
  const viewResult = await main.observe();
  if (!viewResult.ok) return viewResult;
  await using view = viewResult.value; // A owned subscription; stable snapshots.
  const unsubscribe = view.subscribe(() => paint(view.getSnapshot()));
  try {
    const shown = view.getSnapshot(); // Capture before preparation.
    paint(shown);
    if (shown.kind !== "ready") return;
    const content = await prepare(); // Later navigation cannot retarget this input.
    return await main.steer(content, { configuration: choice, history: shown.value.history });
    // Resolves at host receipt. Local acknowledgement is queueWithJournal in section 6.
  } finally {
    unsubscribe();
  }
  // Configuration rides with the input. Observation never drives execution.
}

// tree pins a coherent graph. navigate admits a keyed command against its revision.
async function navigate(
  sdk: Sdk,
  id: SessionId,
  select: (nodes: readonly HistoryNode[]) => Position,
) {
  const main = sdk.session(id);
  const graphResult = await main.tree();
  if (!graphResult.ok) return graphResult;
  await using graph = graphResult.value; // A pinned retained graph, not transcript-only.
  const nodes: HistoryNode[] = [];
  for await (const pageResult of graph.pages()) {
    if (!pageResult.ok) return pageResult;
    nodes.push(...pageResult.value);
  }
  const selection = select(nodes); // start | commit, never null.
  const renewResult = await graph.renew();
  if (!renewResult.ok) return renewResult;
  if (renewResult.value.kind === "expired")
    return { ok: false, error: { kind: "snapshot-expired" } } as const;
  const operationResult = await main.navigate({
    key: sdk.keys.command(),
    selection,
    expect: graph.revision,
    abandoned: { kind: "summarize", instructions: "Keep conclusions and paths" },
    running: { kind: "refuse" },
  });
  if (!operationResult.ok) return operationResult;
  return await operationResult.value.settled();
  // navigated.handback.message is the selected user commit's content, offered
  // back to the caller. Graph close releases the pin, not heads or commits.
}

// edit stops the exact run, revalidates, then publishes move + replacement input.
async function edit(
  sdk: Sdk,
  id: SessionId,
  shown: SessionView,
  message: CommitId,
  replacement: UserContent,
) {
  const main = sdk.session(id);
  const running: NavigationRunning =
    shown.execution.kind === "live"
      ? { kind: "stop", runId: shown.execution.run.id }
      : { kind: "refuse" };
  const operationResult = await main.edit({
    key: sdk.keys.command(),
    message,
    expect: shown.revision,
    running,
    replacement: {
      content: replacement,
      ...(shown.configuration.selected === null
        ? {}
        : { configuration: shown.configuration.selected }),
    },
  });
  if (!operationResult.ok) return operationResult;
  return await operationResult.value.settled();
  // Core never looks up "current" to stop it and never stops a replacement run.
}

// markSeen is a forward-only reader mark. Core keeps the mark; a window keeps
// its divider and scroll anchor as per-visit memory.
async function markSeen(sdk: Sdk, id: SessionId, shownCommits: AsyncIterable<CommitId>) {
  const main = sdk.session(id);
  const viewResult = await main.observe();
  if (!viewResult.ok) return viewResult;
  await using view = viewResult.value;
  const opened = view.getSnapshot();
  if (opened.kind !== "ready") return;
  const divider = opened.value.unseen; // Frozen for this visit. Later marks never move it.
  for await (const commit of shownCommits) {
    // Only TurnPartView commits shown while visible and focused; coalesce per head.
    const marked = await main.markSeen({ kind: "commit", id: commit });
    if (!marked.ok) return marked;
  }
  return { ok: true, value: divider } as const;
  // A second device marking further ahead changes HeadInfoView.unseen, not this divider.
}

// 2. Values. Derive these types from one canonical domain schema.
// Use the existing schema library as the source of truth for inputs, outcomes
// and failures. Requirements are local dependencies, never serialized services.

// Expected operation failures are values. Defects and cleanup exceptions reject.
// Result uses the existing core/kernel/result.ts discriminant, not a new runtime.
type Result<Success, Failure> =
  | { readonly ok: true; readonly value: Success }
  | { readonly ok: false; readonly error: Failure };

// All public failure records are schema-derived and safe to cross IPC/HTTP.
// A failure names what failed and preserves the recovery identity when work may
// have started. Host logs keep private causes under correlation, not wire stacks.
type ValidationIssue = {
  readonly severity: "error" | "warning";
  readonly path: readonly (string | number)[]; // JSON pointer segments into the input or declaration.
  readonly message: string;
  readonly source?: { readonly plugin: string; readonly file?: string; readonly line?: number };
};
// One issue shape for request validation and plugin/declaration checks. source
// names the plugin and, for loaded files, file:line, so a report reads
// "error user/keys.ts:12 commands.add: duplicate name". A warning never
// rejects; an error rejects exactly the declaration or request it points at.
type SdkFailure =
  | { readonly kind: "invalid-input"; readonly issues: readonly ValidationIssue[] }
  | { readonly kind: "unauthenticated"; readonly reason: string }
  | { readonly kind: "denied"; readonly operation: string; readonly reason: string }
  | { readonly kind: "missing"; readonly resource: string }
  | { readonly kind: "unavailable"; readonly capability: string; readonly reason: string }
  | { readonly kind: "key-conflict"; readonly identity: WriteIdentity }
  | { readonly kind: "snapshot-expired" }
  | { readonly kind: "configuration-rejected"; readonly reason: string }
  | {
      readonly kind: "history-changed";
      readonly expected: HistoryEpoch;
      readonly current: HistoryEpoch;
      readonly key: SubmissionKey;
    }
  | { readonly kind: "transport"; readonly attempt: TransportAttempt; readonly message: string }
  | { readonly kind: "closed"; readonly attempt: RequestAttempt }
  | { readonly kind: "request-aborted"; readonly attempt: RequestAttempt }
  | {
      readonly kind: "io";
      readonly operation: string;
      readonly message: string;
      readonly attempt: RequestAttempt;
      readonly correlation: string;
    }
  | { readonly kind: "capacity"; readonly resource: string; readonly limit: number }
  | { readonly kind: "internal"; readonly correlation: string; readonly attempt: RequestAttempt };

type RequestFailure = Extract<
  SdkFailure,
  {
    readonly kind:
      | "invalid-input"
      | "unauthenticated"
      | "denied"
      | "missing"
      | "unavailable"
      | "transport"
      | "closed"
      | "request-aborted"
      | "io"
      | "internal";
  }
>;
type MutationFailure = RequestFailure | Extract<SdkFailure, { readonly kind: "key-conflict" }>;
type AdmissionFailure =
  | MutationFailure
  | Extract<
      SdkFailure,
      {
        readonly kind: "configuration-rejected" | "history-changed";
      }
    >;
type ConfigurationFailure =
  | MutationFailure
  | Extract<SdkFailure, { readonly kind: "configuration-rejected" }>;
type HistoryFailure =
  | RequestFailure
  | Extract<SdkFailure, { readonly kind: "snapshot-expired" | "capacity" }>;
type CommandFailure =
  | MutationFailure
  | Extract<SdkFailure, { readonly kind: "configuration-rejected" | "capacity" }>;
type ResourceOpenFailure = MutationFailure | Extract<SdkFailure, { readonly kind: "capacity" }>;
type JournalFailure = Extract<
  SdkFailure,
  { readonly kind: "invalid-input" | "io" | "closed" | "capacity" | "history-changed" }
>;
type HostOpenFailure =
  | ResourceOpenFailure
  | Extract<SdkFailure, { readonly kind: "configuration-rejected" }>;
type ConnectionFailure = ResourceOpenFailure;

// These named unions are the readable view of operation.failure schemas. A
// generated method uses its declared subset; adding a failure changes its type.
// Conflicts, busy, partial writes and run failure remain domain outcomes when
// the requested operation successfully determines that outcome. The Result
// error branch means the request could not produce its declared outcome.
// Runtime requirements, such as workspace trust, remain WorkspaceActivation
// data. They are not missing TypeScript dependencies.
//
// Validate inputs, declared dependencies, permissions and known expectations
// before opening resources, stopping runs, charging a provider or mutating files.
// Check authoritative state again at publication. Preflight is not a lock.
// Unknown writes never become confirmed failures: preserve their identity and
// reconcile before retry. Never catch every exception and invent a domain result.
// Local implementation defects reject as unknown; a remote boundary redacts
// those defects to internal with correlation and publication certainty.
//
// Streams yield Result<Frame, Failure>. An expected terminal failure is yielded
// once, then the stream ends and releases its reader. End without error is normal
// completion; return() detaches observation. Recovery/gap frames remain data.
// Unexpected iterator defects reject. Owned.close/asyncDispose are the deliberate
// cleanup exception: both reject AggregateError after attempting every finalizer,
// so await using cannot silently discard a failed cleanup Result.

type WriteIdentity = { readonly host: HostId; readonly principal: PrincipalId } & (
  | {
      readonly kind: "input";
      readonly session: SessionId;
      readonly head: HeadName;
      readonly key: SubmissionKey;
    }
  | { readonly kind: "command"; readonly key: CommandKey }
  | { readonly kind: "create-session"; readonly session: SessionId }
  | { readonly kind: "acquisition"; readonly workspace: WorkspaceId; readonly key: AcquisitionKey }
  | { readonly kind: "convergent"; readonly target: DomainStateAddress }
  | { readonly kind: "volatile"; readonly target: RuntimeResourceAddress; readonly attempt: string }
);
type TransportAttempt =
  | { readonly kind: "read"; readonly retry: "read-only" | "manual" }
  | { readonly kind: "not-attempted"; readonly identity: null; readonly retry: "manual" }
  | {
      readonly kind: "not-attempted" | "unknown";
      readonly identity: Exclude<WriteIdentity, { readonly kind: "volatile" }>;
      readonly retry: "same-key" | "manual";
    }
  | {
      readonly kind: "not-attempted" | "unknown";
      readonly identity: Extract<WriteIdentity, { readonly kind: "volatile" }>;
      readonly retry: "manual";
    };
// Same-key retry requires an identity and excludes volatile actions.
type RequestAttempt =
  | { readonly kind: "read" }
  | { readonly kind: "not-attempted"; readonly identity: WriteIdentity | null }
  | { readonly kind: "unknown"; readonly identity: WriteIdentity };

type Id<Name extends string> = string & { readonly __brand: Name };
type SessionId = Id<"session">;
type HeadName = Id<"head">;
type CommitId = Id<"conversation-commit">;
type InputChangeId = Id<"input-change">;
type RunId = Id<"run">;
type CallId = Id<"tool-call">;
type WaitId = Id<"wait-generation">;
type SubmissionKey = Id<"submission-key">;
type CommandKey = Id<"command-key">;
type WorkspaceId = Id<"workspace">;
type HostId = Id<"authenticated-host">;
type PrincipalId = Id<"authenticated-principal">;
type EnvironmentId = Id<"execution-environment">;
type PageId = Id<"browser-page">;
type TerminalId = Id<"terminal">;
type JobId = Id<"job">;
type FileVersion = Id<"file-version">;
type FileSnapshotId = Id<"workspace-file-snapshot">;
type GitCommitId = Id<"git-commit">;
type GitRevision = Id<"git-working-state">;
type BranchRevision = Id<"branch-view-revision">;
type HistoryEpoch = Id<"history-generation">;
type SideHeadName = HeadName & { readonly __side: true };
type AcquisitionKey = Id<"resource-acquisition">;
type DocumentRevision = Id<"browser-document-revision">;
type Cursor = Id<"cursor">;
type BlobId = Id<"blob">;
type Seq = number & { readonly __brand: "session-sequence" };
type Json = null | boolean | number | string | readonly Json[] | { readonly [name: string]: Json };

type UserContent =
  | string
  | readonly (
      | { readonly kind: "text"; readonly text: string }
      | { readonly kind: "image"; readonly blob: BlobId; readonly mime: string }
    )[];
// Blob storage owns uploaded bytes. A blob reference never exposes a local path.
// Conversation commits, file snapshots, Git objects and page IDs cannot substitute.

type Lookup<T> = { readonly kind: "found"; readonly value: T } | { readonly kind: "missing" };
type Page<T> = { readonly items: readonly T[]; readonly next: Cursor | null };
// next:null means known end. Omitted cursor in a request means first page.

type Position = { readonly kind: "start" } | { readonly kind: "commit"; readonly id: CommitId };
type ParentFilter =
  | { readonly kind: "all" }
  | { readonly kind: "roots" }
  | { readonly kind: "children"; readonly session: SessionId };
type QueuePosition =
  | { readonly kind: "last" }
  | { readonly kind: "before"; readonly key: SubmissionKey };
type Capability<T> =
  | { readonly kind: "available"; readonly value: T }
  | { readonly kind: "unsupported"; readonly reason: string }
  | { readonly kind: "denied"; readonly reason: string }
  | { readonly kind: "unavailable"; readonly retry: "allowed" | "manual"; readonly reason: string };
// Capability reports permission/provision, not file/session/page existence.
// An available handle still rechecks revocation at every external boundary.

type RequestOptions = { readonly signal?: AbortSignal };
// signal omission = no caller-supplied interruption. null rejected.
// Abort stops this request/wait. A submitted write may already have committed.

interface Owned {
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}
// Both methods perform the same idempotent release. Close rejects new calls,
// settles accepted local cleanup, tries every finalizer and reports aggregate
// failures. It never silently deletes data.

type ModelRef = { readonly provider: string; readonly id: string };
// Fast mode is a model, not a policy: each eligible catalog model has a
// `<id>-fast` sibling carrying `variant: { mode: "fast", base }` (today:
// ai/model-variants.ts). The sibling is the selected identity in ModelRef,
// catalog, availability and spans; its base is the provider identity, which
// ai lowers to at the request boundary and which every answer, checkpoint and
// stored message is recorded under. Nothing above ai lowers or relabels.
type Thinking = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
type ChoicePatch = {
  readonly kind: "patch"; // Required discriminant; nullable fields are clear commands.
  readonly model?: ModelRef;
  readonly thinking?: Thinking | null;
  readonly agent?: string | null;
  readonly requestPolicy?: RequestPolicyPatch;
};
// model omitted -> retain/capture branch model; null model is invalid.
// thinking/agent omitted -> retain/capture selected value.
// thinking:null / agent:null -> clear override, resolve host/agent default at admission.
// The receipt contains the resolved choice, never an unresolved default callback.
interface RequestPolicyPatch {
  // fast is not policy: a `<id>-fast` model ref in `model` carries it.
  readonly settings?: Readonly<Record<string, Json>>; // omitted keep; validated per registered policy.
}
interface ResolvedChoice {
  readonly kind: "exact"; // Required discriminant; values, not clear commands.
  readonly model: ModelRef;
  readonly thinking: Thinking;
  readonly agent: string | null; // null = explicitly the built-in agent, not current defaults.
  readonly requestPolicy: {
    readonly settings: Readonly<Record<string, Json>>;
    readonly definitionVersion: string;
  };
}
type InputChoice = ChoicePatch | ResolvedChoice;
// Exact choice preserves model/thinking/agent and the full request-policy
// definitionVersion. Reject unusable versions; do not drop them or re-resolve
// defaults. Exact agent:null is a value, not patch agent:null's reset command.
// The disjoint union rejects that conversion. configure accepts only kind:patch;
// submission/edit also accept kind:exact.
// For example: queue(text, {configuration:{kind:"patch",model:{provider,id}}}).
// Admission resolves request-affecting plugin settings, includes them in the
// request digest/compatibility comparison and passes them to before_request.
// Fast rides on the captured model ref, so no hook reads a fast setting. UI-only
// preferences stay outside input choice. A fast ref for a model with no fast
// sibling is unknown_model, never silently upgraded or downgraded at premium cost.
interface KeyFactory {
  submission(): SubmissionKey; // S secure unique ID, no network.
  command(): CommandKey; // S a different identity space.
  acquisition(): AcquisitionKey; // S recover an opener after an unknown reply.
}

// 3. Core admission. A message is not a run.

interface SubmitOptions {
  readonly key?: SubmissionKey; // omission mints once per invocation.
  readonly history?: HistoryEpoch; // shown history; omission follows rule below.
  readonly configuration?: InputChoice; // omission captures branch selection at admission.
  readonly source?: string; // optional attribution, never execution permission.
}
interface AdmissionRecord {
  readonly key: SubmissionKey;
  readonly session: SessionId;
  readonly head: HeadName;
  readonly change: InputChangeId;
  readonly history: HistoryEpoch;
  readonly execution: "covered" | "uncovered"; // Admission-time observation, not a liveness guarantee.
  readonly choice: ResolvedChoice;
  readonly intent: "steer" | "queue";
  readonly placement:
    | { readonly kind: "response-boundary"; readonly runId: RunId }
    | {
        readonly kind: "next-turn";
        readonly reason: "requested" | "idle" | "run-ended" | "configuration";
      };
}
type InputLanding =
  | { readonly kind: "landed"; readonly commit: CommitId; readonly runId: RunId }
  | { readonly kind: "withdrawn" }
  | { readonly kind: "superseded"; readonly by: SubmissionKey };
// AdmissionRecord is the admission-time receipt; landing observes final placement.
interface InputHandle {
  readonly key: SubmissionKey;
  receipt(): Promise<Result<Lookup<AdmissionRecord>, RequestFailure>>;
  landing(options?: RequestOptions): Promise<Result<InputLanding, RequestFailure>>; // O wait only.
  withdraw(options?: RequestOptions): Promise<Result<Withdrawal, MutationFailure>>; // O the single withdrawal operation.
}
interface AdmittedInput extends InputHandle {
  readonly record: AdmissionRecord;
}
// Head.input(key) reacquires the same InputHandle even before receipt. The client
// journal submits intent; only core confirms withdrawal. A host landed receipt
// overrides local assumptions. Offline withdrawal retains an uncertain tombstone
// intent, not a fabricated host rejection.
type Withdrawal =
  | { readonly kind: "withdrawn" }
  | { readonly kind: "landed"; readonly commit: CommitId; readonly runId: RunId }
  | { readonly kind: "uncertain"; readonly key: SubmissionKey };
// Reconcile network failures by original key; they cannot confirm withdrawal.
// Withdrawing an unseen key durably prevents its later admission. Tombstones
// are scoped by host + principal + session + head, cannot cancel another
// principal's work, and cannot expire while that key remains replayable.

interface ConfigurationReceipt {
  readonly key: CommandKey;
  readonly revision: BranchRevision;
  readonly selected: ResolvedChoice;
}

interface PendingInputs {
  list(): Promise<Result<readonly PendingInput[], RequestFailure>>;
  revise(input: {
    readonly key: SubmissionKey;
    readonly expect: BranchRevision;
    readonly content?: UserContent; // omit = keep content, not clear.
    readonly delivery?: "steer" | "queue"; // omit = keep intention.
    readonly position?: QueuePosition; // omit = keep order; no nullable position.
  }): Promise<Result<PendingRevision, MutationFailure>>;
}
type PendingInput = { readonly record: AdmissionRecord; readonly state: "pending" };
type PendingRevision =
  | { readonly kind: "revised"; readonly input: AdmissionRecord }
  | { readonly kind: "unchanged" }
  | { readonly kind: "landed"; readonly runId: RunId }
  | { readonly kind: "stale"; readonly current: BranchRevision }
  | { readonly kind: "missing" };

/**
 * Admission transaction:
 * 1. Parse and authorize once at the boundary; normalize/upload before CAS.
 * 2. Look up the key within this principal/session/head. The same normalized
 *    request digest returns the original receipt; a different digest returns
 *    KeyConflict. Hash requested content/delivery/epoch/choice patch. Retries use
 *    the original resolved defaults. The resolved policy snapshot has a separate
 *    immutable compatibility digest.
 * 3. Resolve selected configuration and create the immutable input/config record.
 * 4. Assert history epoch and publish input + receipt + runnable obligation in
 *    one store transaction, under the same four authorities, not another workflow DB.
 * 5. Wake is a hint; the scheduler repairs durable runnable heads after crashes.
 *
 * Navigation/edit advances history generation; model commits and append-only
 * compaction do not. It is not the moving tip. The journal freezes the epoch
 * before acknowledging local storage, so delayed inputs cannot cross a rewind
 * even if they were absent from the host inbox.
 *
 * UI callers pass the displayed epoch. When omitted, SDK captures its latest
 * observed epoch at invocation or reads it before storage/admission. Offline
 * without an epoch is not-stored. Retries keep that epoch. Stale input stays
 * locally held and returns history-changed; rebase requires user intent and a
 * new key. A newly created session handle knows its initial epoch.
 *
 * .steer joins a compatible live run at the next safe response boundary, never
 * during provider streaming or external tool execution. If the run ends first,
 * the same input becomes next-turn input without client resend. Incompatible
 * configuration becomes next-turn input with reason configuration.
 *
 * .queue starts at an idle boundary after eligible steers. Drain-all combines
 * only a leading compatible configuration group; later model choices cannot
 * override earlier inputs through passive configs. Resolved choice survives
 * restart. Prepare and record prompt/tool declarations before each provider
 * request, not during admission. Recovery never silently substitutes an
 * unavailable model or previously offered tool catalog.
 *
 * configure changes durable defaults. Per-input configuration affects only
 * that input, not shared session defaults; no configure-then-send is needed.
 */

// 4. Session and head handles. Binding is synchronous; mutations are not fluent.

interface Sdk {
  readonly hostId: HostId;
  readonly principal: PrincipalId;
  readonly keys: KeyFactory;
  readonly sessions: SessionsDirectory;
  readonly workspaces: WorkspaceDirectory;
  readonly models: ModelDirectory;
  readonly deliveries: DeliveryJournal;
  readonly administration: AdministrationCapabilities;
  readonly operations: OperationsDirectory;
  catalog(options?: RequestOptions): Promise<Result<CatalogView, RequestFailure>>; // O self-description of this host.
  events(options?: RequestOptions): AsyncIterable<Result<HostEventFrame, RequestFailure>>; // W host-wide facts, not session history.
  session(id: SessionId): SessionHandle; // S main head + session management.
  workspace(id: WorkspaceId): WorkspaceHandle; // S stable workspace, not UI selection.
}
interface CatalogView {
  readonly generation: CatalogGeneration;
  readonly operations: readonly OperationInfoView[];
  readonly commands: readonly CommandInfoView[];
  readonly tools: readonly ToolInfoView[];
}
interface OperationInfoView {
  readonly name: string;
  readonly description: string;
  readonly authority: OperationDeclaration<unknown, unknown, unknown>["authority"];
  readonly execution: OperationDeclaration<unknown, unknown, unknown>["execution"];
  readonly input: JsonSchema;
  readonly output: JsonSchema;
  readonly failure: JsonSchema;
  readonly example?: { readonly request: Json; readonly response: Json };
  readonly notes?: readonly string[]; // rules the schema cannot express.
}
interface ToolInfoView {
  readonly name: string;
  readonly owner: string;
  readonly description: string;
  readonly parameters: JsonSchema;
}
type CatalogGeneration = Id<"catalog-generation">;
type JsonSchema = { readonly [name: string]: Json };
type HostEventFrame =
  | { readonly kind: "catalog-changed"; readonly generation: CatalogGeneration }
  | {
      readonly kind: "plugins-changed";
      readonly generation: CatalogGeneration;
      readonly plugins: readonly PluginInfoView[];
    }
  | { readonly kind: "settings-changed"; readonly keys: readonly string[] };
// The catalog is the same OperationDeclaration data that generates the TS
// client, served at runtime so a host on another version, a non-TS client or
// an agent can bind without our docs. Plugin commands and tools appear under
// their owner. A name absent from the catalog answers unavailable, never a
// transport failure. catalog-changed replaces client-side plugin invalidation;
// a client refetches lists it caches and compares generation. Unknown frame
// kinds are skipped per the section 9 rule.
interface SessionsDirectory {
  create(input?: {
    readonly id?: SessionId; // omit -> generated before first attempt.
    readonly name?: string; // omit -> unnamed; null invalid.
    readonly workspace?: WorkspaceId; // omit -> host's declared default, never UI global.
    readonly configuration?: InputChoice;
  }): Promise<Result<SessionHandle, ConfigurationFailure>>; // A durable creation; handle itself is not Owned.
  find(id: SessionId): Promise<Result<Lookup<SessionInfoView>, RequestFailure>>;
  list(input?: {
    readonly parents?: ParentFilter;
    readonly cursor?: Cursor;
    readonly limit?: number;
  }): Promise<Result<Page<SessionInfoView>, RequestFailure>>;
}
// Stable id+request digest makes creation idempotent; a different payload
// conflicts. A parent's history pointer does not grant delegation ownership.

interface HeadHandle {
  readonly sessionId: SessionId;
  readonly name: HeadName;
  view(options?: RequestOptions): Promise<Result<SessionView, RequestFailure>>; // O missing addressed resource is error.
  observe(options?: RequestOptions): Promise<Result<SessionObservation, ResourceOpenFailure>>; // A local owned subscription.
  events(
    input: { readonly from: "start" | "live" | Seq },
    options?: RequestOptions,
  ): AsyncIterable<Result<SessionEventFrame, RequestFailure>>; // W advanced raw feed.
  steer(
    content: UserContent,
    options?: SubmitOptions,
  ): Promise<Result<AdmittedInput, AdmissionFailure>>; // O.
  queue(
    content: UserContent,
    options?: SubmitOptions,
  ): Promise<Result<AdmittedInput, AdmissionFailure>>; // O.
  configure(
    patch: ChoicePatch,
    options?: { readonly key?: CommandKey },
  ): Promise<Result<ConfigurationReceipt, ConfigurationFailure>>; // O.
  // configure, steer/queue and settings.apply on one session are admitted in
  // call order on one Nyte (today: session-pool.ts inOrder), so a configure
  // need not be awaited before a send; across hosts CAS decides.
  readonly pending: PendingInputs;
  input(key: SubmissionKey): InputHandle; // S one withdrawal/reconciliation address.
  run(id: RunId): RunHandle; // S exact identity, not whatever is currently live.
  tree(options?: RequestOptions): Promise<Result<HistoryReader, HistoryFailure>>; // A retained graph pin.
  branch(input: {
    readonly name: string;
    readonly from: Position;
    readonly key: CommandKey;
  }): Promise<Result<BranchOutcome, MutationFailure>>; // O.
  navigate(input: NavigateInput): Promise<Result<Operation<NavigationOutcome>, CommandFailure>>; // O admitted long operation.
  edit(input: EditInput): Promise<Result<Operation<EditOutcome>, CommandFailure>>; // O replaces app sequencing.
  compact(input: {
    readonly key: CommandKey;
    readonly instructions?: string;
  }): Promise<Result<Operation<CompactResult>, CommandFailure>>; // O keyed paid operation.
  context(): Promise<Result<ContextView, RequestFailure>>; // O selected provider input/token accounting.
  markSeen(
    position: Position,
    options?: RequestOptions,
  ): Promise<Result<SeenOutcome, MutationFailure>>; // O forward-only; no wake, no revision change.
}
interface SideHeadHandle extends HeadHandle {
  readonly name: SideHeadName;
  merge(input: { readonly expect: BranchRevision }): Promise<Result<MergeResult, MutationFailure>>; // O stack-parent fast-forward.
  remove(input: {
    readonly expect: BranchRevision;
  }): Promise<Result<RemoveHeadResult, MutationFailure>>; // O.
}
interface SessionHandle extends HeadHandle {
  readonly id: SessionId;
  head(name: SideHeadName): SideHeadHandle; // S main is already bound; side name parsed once.
  info(): Promise<Result<SessionInfoView, RequestFailure>>;
  update(patch: {
    readonly name?: string | null;
    readonly pinned?: boolean;
    readonly archived?: boolean;
  }): Promise<Result<void, MutationFailure>>;
  // name:null clears title; omitted fields unchanged. Null booleans rejected.
  removeSession(input: {
    readonly expect: BranchRevision;
  }): Promise<Result<RemoveSessionResult, MutationFailure>>;
  heads(): Promise<Result<readonly HeadInfoView[], RequestFailure>>;
  children(): Promise<Result<readonly SessionInfoView[], RequestFailure>>; // Delegated sessions, not conversation heads.
  readonly jobs: JobsApi;
  readonly plugins: PluginReadApi;
}
type BranchOutcome =
  | { readonly kind: "created"; readonly head: SideHeadHandle; readonly basedOn: Position }
  | { readonly kind: "exists"; readonly name: HeadName }
  | { readonly kind: "missing-source" };
// branch creates a named head in this session, retains history and copies
// historical config/tool declarations at from. Its inbox is empty; it creates
// no inference, run, effects or jobs. Workspace stays shared. It is not a Git
// branch, copied session, delegated child or isolated filesystem. Parallel
// writers should provision a separate workspace. v1 has no cross-session fork;
// a future clone needs explicit copy policies, not an alias for branch or delegation.create.

interface RunHandle {
  readonly id: RunId;
  info(): Promise<Result<RunRecord, RequestFailure>>; // Addressed missing run is SdkFailure.missing.
  stop(): Promise<Result<StopResult, MutationFailure>>; // O durable Stop accepted; not process cleanup completion.
  settled(options?: RequestOptions): Promise<Result<RunEnd, RequestFailure>>; // O exact run, never a later run.
  reply(input: {
    readonly call: CallId;
    readonly wait: WaitId;
    readonly value: Json;
  }): Promise<Result<ReplyResult, MutationFailure>>; // O.
  changes(): Promise<Result<RunChanges, RequestFailure>>; // O exact snapshots or explicitly incomplete records.
  restore(input: {
    readonly key: CommandKey;
    readonly evidence: ExactRunChanges;
  }): Promise<Result<Operation<RestoreResult>, CommandFailure>>;
}
type StopResult =
  | { readonly kind: "requested" }
  | { readonly kind: "ended"; readonly end: RunEnd }
  | { readonly kind: "missing" };
type ReplyResult =
  | { readonly kind: "accepted" }
  | { readonly kind: "stale-wait" }
  | { readonly kind: "missing" };
type RunEnd =
  | { readonly kind: "completed" }
  | { readonly kind: "stopped" }
  | { readonly kind: "failed"; readonly diagnostic: string };
type RunRecord =
  | { readonly kind: "live"; readonly run: RunView }
  | { readonly kind: "ended"; readonly id: RunId; readonly end: RunEnd };
interface RunView {
  readonly id: RunId;
  readonly phase: "responding" | "executing" | "waiting" | "retrying";
  readonly configuration: ResolvedChoice;
}
type ExecutionView =
  | { readonly kind: "idle"; readonly last: RunId | null }
  | { readonly kind: "live"; readonly run: RunView };
// last:null = no previous run, not an optional isRunning/runId pair.
// Stop revokes this run's continuation grants. Delegation ownership, not branch
// ancestry, authorizes cancellation of child sessions.

// 5. /tree, edit, compaction. Shared by all consumers, including remote clients.

interface HistoryReader extends Owned {
  readonly revision: BranchRevision;
  readonly atSeq: Seq;
  readonly expiresAt: number; // Current host lease deadline in epoch milliseconds.
  readonly renewableUntil: number; // Hard lifetime limit, fixed at acquisition.
  readonly heads: readonly HeadInfoView[];
  renew(): Promise<
    Result<
      { readonly kind: "renewed"; readonly until: number } | { readonly kind: "expired" },
      HistoryFailure
    >
  >;
  pages(): AsyncIterable<Result<readonly HistoryNode[], HistoryFailure>>; // W bounded parent-before-child pages.
}
interface HistoryNode {
  readonly id: CommitId;
  readonly parent: CommitId | null; // null = root, never missing page/loading.
  readonly kind:
    | "user"
    | "assistant"
    | "tool"
    | "system"
    | "config"
    | "checkpoint"
    | "summary"
    | "completion"
    | "usage";
  readonly imports: readonly CommitId[];
  readonly preview: string;
}
type NavigationRunning =
  | { readonly kind: "refuse" }
  | { readonly kind: "stop"; readonly runId: RunId };
interface NavigateInput {
  readonly key: CommandKey;
  readonly selection: Position;
  readonly expect: BranchRevision;
  readonly running: NavigationRunning;
  readonly abandoned:
    | { readonly kind: "keep" }
    | { readonly kind: "summarize"; readonly instructions?: string };
}
interface EditInput {
  readonly key: CommandKey;
  readonly message: CommitId; // Must resolve to a user message, checked at boundary.
  readonly expect: BranchRevision;
  readonly running: NavigationRunning;
  readonly replacement: { readonly content: UserContent; readonly configuration?: InputChoice };
}
interface Operation<Outcome> {
  readonly key: CommandKey;
  status(): Promise<
    Result<
      { readonly kind: "pending" } | { readonly kind: "settled"; readonly outcome: Outcome },
      RequestFailure
    >
  >;
  settled(options?: RequestOptions): Promise<Result<Outcome, RequestFailure>>; // O wait; abort doesn't cancel command.
  stop(): Promise<
    Result<
      { readonly kind: "requested" } | { readonly kind: "settled"; readonly outcome: Outcome },
      MutationFailure
    >
  >; // O explicit command stop.
}
type NavigationOutcome =
  | {
      readonly kind: "navigated";
      readonly revision: BranchRevision;
      readonly position: Position;
      readonly handback:
        | { readonly kind: "none" }
        | { readonly kind: "message"; readonly content: UserContent };
      readonly summary: CommitId | null; // null = no summary published.
    }
  | { readonly kind: "stale"; readonly current: BranchRevision; readonly stoppedRun: RunId | null }
  | { readonly kind: "busy"; readonly runId: RunId }
  | { readonly kind: "pending-input"; readonly keys: readonly SubmissionKey[] }
  | { readonly kind: "missing-target" }
  | { readonly kind: "stopped"; readonly stoppedRun: RunId | null }
  | {
      readonly kind: "summary-failed";
      readonly diagnostic: string;
      readonly stoppedRun: RunId | null;
    };
type EditOutcome =
  | {
      readonly kind: "edited";
      readonly revision: BranchRevision;
      readonly admission: AdmissionRecord;
    }
  | Exclude<NavigationOutcome, { readonly kind: "navigated" }>;

/**
 * Tree contract:
 * - A coherent manifest of retained OIDs, head tips and seq is protected from GC
 *   by a read pin with bounded, renewable expiry. The host supplies positive,
 *   finite leaseMs/maxLifetimeMs/maxReaders limits before opening storage.
 *   Renew extends expiresAt by at most leaseMs, never beyond renewableUntil.
 *   Failed or expired renewal does not acquire a different graph. Reopen explicitly.
 *   Expiry gives snapshot-expired, never pages from a later graph. Close releases
 *   the pin; an abandoned reader expires without requiring its client to return.
 * - All retained branches, including abandoned history, are available. UI may
 *   hide usage nodes, but they stay addressable. Transcript is not the graph.
 * - BranchRevision is an opaque token covering relevant head/run/config/inbox
 *   expectations, not wall time or only the displayed tip. Seen marks are
 *   outside it; reading cannot make navigate/edit stale.
 * - Selecting a user commit moves to its parent and offers its content. Other
 *   nodes land on themselves. Keep and summarize preserve history.
 * - Summary uses source configuration, has the landing point as parent and
 *   imports abandoned commits. Failed CAS does not erase recorded provider spend.
 *
 * navigate/edit store command state in objects/refs using existing fenced steps,
 * not UI-held RPC requests, another workflow database or persisted JS continuations.
 *
 * Before Stop, validate revision, pending inbox and target, then pin the target.
 * Pre-checkable refusals cannot stop a run. After Stop, changed inbox/head conditions
 * return stale, not pending-input/missing-target. Callers explicitly choose the
 * default refuse behavior or stop the exact observed run. Stop settlement is
 * irreversible and precedes navigation; stoppedRun reports it if navigation fails.
 * Revalidation accepts only changes caused by that stop. Unrelated head/config/inbox
 * changes return stale, not an automatic reread/retry.
 *
 * Pending user inputs block move/edit. Callers must withdraw or place them before
 * retrying; inputs are never silently discarded or retargeted.
 *
 * After preparation, one CAS publishes move + optional summary and, for edit,
 * replacement input + captured choice + receipt + wake obligation. Failure before
 * CAS leaves history unchanged. Plain navigate never starts model work. Command
 * stop can prevent publication; after publication it returns the settled result.
 * Transport interruption stops only waiting.
 *
 * The edit CAS increments history epoch and admits replacement against it. Old
 * locally retained inputs fail their epoch assertion. Admitted commands retain
 * their own targets, so closing a picker cannot expose them to GC.
 * File restore is outside this transaction.
 */

// 6. Observation and the request gap. One SDK implementation, no UI controller.

interface SessionView {
  readonly revision: BranchRevision;
  readonly history: HistoryEpoch;
  readonly activation: WorkspaceActivation;
  readonly seq: Seq;
  readonly position: Position;
  readonly seen: SeenMark;
  readonly unseen: CommitId | null; // oldest drawn commit after the mark; null = nothing unseen.
  readonly transcript: readonly TurnView[];
  readonly pending: readonly PendingInput[];
  readonly parked: readonly ParkedWait[];
  readonly execution: ExecutionView;
  readonly configuration: {
    readonly selected: ResolvedChoice | null;
    readonly effective: ResolvedChoice | null;
  };
  readonly transient: {
    readonly completeness: "complete" | "gap";
    readonly parts: readonly LivePartView[];
  };
}
type WorkspaceActivation =
  | { readonly kind: "active" }
  | { readonly kind: "inactive" }
  | { readonly kind: "trust-required" }
  | { readonly kind: "unavailable"; readonly reason: string };
// selected:null = no model configuration; effective:null = no effective request yet.
// Reading history must not load project code or demand active model credentials.
interface ParkedWait {
  readonly run: RunId;
  readonly call: CallId;
  readonly generation: WaitId;
  readonly reason:
    | { readonly kind: "question"; readonly selection: Selection; readonly deadline: number | null }
    | {
        readonly kind: "dependency";
        readonly ids: readonly CommandKey[];
        readonly deadline: number | null;
      }
    | { readonly kind: "timer"; readonly deadline: number };
}
// deadline:null = no timer; never "not loaded".

type SeenMark =
  | { readonly kind: "never" } // no reader has marked this head.
  | { readonly kind: "at"; readonly position: Position }; // start = opened empty; commit = on the tip's chain.
type SeenOutcome =
  | { readonly kind: "advanced"; readonly seen: Position } // mark moved forward; one fact event.
  | { readonly kind: "unchanged"; readonly seen: Position } // at or behind the mark; no write, no event.
  | { readonly kind: "missing-target" }; // names no commit of this session.
interface HeadInfoView {
  readonly name: HeadName;
  readonly tip: Position; // start = no commits yet.
  readonly stack: {
    readonly parent: HeadName;
    readonly base: Position;
    readonly stale: boolean;
  } | null; // null = not stacked.
  readonly execution: ExecutionView;
  readonly seen: SeenMark;
  readonly unseen: CommitId | null; // same derivation as SessionView.unseen; sidebar dot = unseen !== null.
}
// Based on protocol/src/sdk.ts:97-106 HeadInfo {head, tip, stack?, run?}; lifecycle states are explicit.
type TurnView =
  | {
      readonly kind: "turn";
      readonly id: CommitId; // first commit of the turn; views.ts:61 Turn.id.
      readonly run: RunId | null; // null = seeded/foreign turn, not unknown.
      readonly parts: readonly TurnPartView[];
      readonly failure: Failure | null; // null = ended without error/abort.
      readonly startedAt: number;
      readonly durationMs: number; // record's span; only grows, transcript.ts:284.
    }
  | {
      readonly kind: "checkpoint";
      readonly commit: CommitId;
      readonly at: number;
      readonly body: CheckpointBody;
    }
  | {
      readonly kind: "summary";
      readonly commit: CommitId;
      readonly at: number;
      readonly body: SummaryBody;
    }
  | {
      readonly kind: "config";
      readonly commit: CommitId;
      readonly at: number;
      readonly body: ConfigBody;
    };
type TurnPartView =
  | {
      readonly kind: "user";
      readonly commit: CommitId;
      readonly content: UserContent;
      readonly at: number;
      readonly key: SubmissionKey | null;
      readonly source: MessageSource | null;
    }
  | {
      readonly kind: "assistant";
      readonly commit: CommitId;
      readonly contentIndex: number;
      readonly text: string;
      readonly at: number;
    }
  | {
      readonly kind: "thinking";
      readonly commit: CommitId;
      readonly contentIndex: number;
      readonly text: string;
      readonly at: number;
    }
  | {
      readonly kind: "tool";
      readonly commit: CommitId;
      readonly call: CallId;
      readonly result: CommitId | null;
      readonly class: TurnToolClass;
      readonly state: ToolState;
      readonly output: string | null;
      readonly at: number;
    };
// Shapes follow protocol/src/views.ts:16-54 and transcript.ts:165-180 part identity.
// user/assistant/thinking name their containing commit; tool names the issuing
// assistant commit. transcript.ts:255 currently drops item.oid. result:null = no
// landed result; key:null = none supplied; source:null = unattributed. Core edit
// resolves the parent instead of UserTurnPart.parent. Part identity is
// (commit, contentIndex) or (commit, call); views own render keys.
type LivePartView =
  | {
      readonly kind: "text" | "thinking";
      readonly run: RunId;
      readonly attempt: number;
      readonly index: number;
      readonly text: string;
    }
  | {
      readonly kind: "tool";
      readonly run: RunId;
      readonly call: CallId;
      readonly progress: ToolProgress;
    };
// client live-parts.ts:3-23. Non-durable parts have no CommitId and cannot be seen
// marks, anchors or under the divider. Landing converts them to TurnPartView.
type ScrollAnchor =
  | { readonly kind: "bottom" }
  | { readonly kind: "commit"; readonly commit: CommitId; readonly offsetPx: number };
// Per-window view memory keyed by session+head, not a fact or wire value.
// At mount, freeze unseen as the divider. Restore the anchor or scroll to the
// divider, bottom when null. Mark only TurnPartView commits shown while the
// document was visible and focused.

/**
 * Seen marks:
 * - Each head has a SeenMark session fact `seen:<head>` in refs/facts/, escaped
 *   per names.ts:150. Its blob names a commit as JSON. gc.ts:49 roots are ref
 *   oids and retained ref events, so seen marks do not pin history.
 * - markSeen(P) maps start to start, an unloadable/non-session commit to
 *   missing-target, and a commit on the tip's chain to P. Otherwise use the
 *   fork point, the newest commit shared by P's and the tip's chains, or start.
 *   Replace a never mark or advance to a strict descendant of the effective
 *   mark; otherwise return unchanged without write/event. On CAS conflict,
 *   re-evaluate against the winner, not writeBlobRef's rewrite retry in
 *   session-pool.ts:374-410.
 * - Reads report the effective mark. Use the stored position on the tip's chain,
 *   its fork point with the tip after navigate/edit/merge, or start if GC made
 *   the stored commit unloadable. navigate/edit leave the mark untouched; the
 *   next markSeen stores an ancestor of the new tip.
 * - unseen is the oldest drawn commit after the effective mark on the tip's
 *   chain. Count user, assistant, tool result, checkpoint, summary and config,
 *   never usage/completion. Listing rows carry unseen per head.
 * - v1 has one authenticated owner per host. That owner's devices share the
 *   seen:<head> mark. Connect binds the owner's PrincipalId. Distinct reader
 *   principals are not supported by v1; they cannot share this fact implicitly.
 * - Seen is outside BranchRevision and HistoryEpoch. Marking never makes a navigate,
 *   edit or input stale, and never starts, wakes or advances execution.
 *
 * Required of the fact write and its readers:
 * - A fact write appends one ref event and wakes observers in the same
 *   transaction; an equal value writes nothing. Its single-ref CAS is disjoint
 *   from head/inbox/run refs and cannot fail admission CAS.
 * - Views coalesce per head, trailing edge, one in flight, bounded rate, using
 *   only the newest shown commit. Forward-only no-op absorbs the rest.
 * - observe folds `seen` locally and recomputes unseen from its transcript,
 *   without a session re-read for fact events.
 * - Fact refs stay outside every runner/advance/warming filter. A future wake
 *   source must be a named ref family, never refs/facts/*.
 */
interface SessionObservation extends Owned {
  getSnapshot(): SessionObservationState; // S referentially stable until semantic change.
  subscribe(listener: () => void): () => void; // S listener disposer only.
  frames(): AsyncIterable<Result<SessionObservationState, RequestFailure>>; // W alternative view consumption.
}
type SessionObservationState =
  | {
      readonly kind: "ready";
      readonly connection:
        | { readonly kind: "live" }
        | { readonly kind: "recovering"; readonly failure: RequestFailure };
      readonly value: SessionView;
      readonly outgoing: readonly LocalDelivery[];
    }
  | { readonly kind: "missing" }
  | { readonly kind: "denied"; readonly reason: string }
  | { readonly kind: "failed"; readonly failure: RequestFailure };
// observe resolves after the initial authoritative read; its pending Promise
// is loading. Denied/missing transitions cannot report stale content as live.

type LocalDelivery = { readonly key: SubmissionKey; readonly content: UserContent } & (
  | { readonly kind: "storing" }
  | { readonly kind: "stored" }
  | { readonly kind: "sending" }
  | { readonly kind: "retrying"; readonly failure: RequestFailure }
  | { readonly kind: "admitted"; readonly record: AdmissionRecord }
  | { readonly kind: "withdrawal-uncertain" }
  | {
      readonly kind: "held";
      readonly failure: Extract<SdkFailure, { readonly kind: "history-changed" }>;
    }
  | { readonly kind: "failed"; readonly failure: AdmissionFailure | JournalFailure }
);
interface DeliveryJournal {
  entry(key: SubmissionKey): DeliveryEntry; // S local identity, no new submission.
}
interface DeliveryEntry {
  stored(): Promise<Result<{ readonly durability: "memory" | "persistent" }, JournalFailure>>; // O local acknowledgement only.
  state(): LocalDelivery | null; // S null means no local entry, not host rejection.
}
async function queueWithJournal(
  sdk: Sdk,
  id: SessionId,
  history: HistoryEpoch,
  draft: UserContent,
  choice: ChoicePatch,
  clearSubmittedDraft: () => void,
) {
  const key = sdk.keys.submission();
  const admission = sdk.session(id).queue(draft, { key, history, configuration: choice });
  const local = sdk.deliveries
    .entry(key)
    .stored()
    .then((stored) => {
      if (stored.ok && stored.value.durability === "persistent") clearSubmittedDraft();
      return stored;
    });
  // Both promises are observed immediately, including unexpected rejection.
  // The callback clears only the captured draft, never newer user input.
  const [stored, receipt] = await Promise.all([local, admission]);
  if (!stored.ok) return stored;
  if (stored.value.durability === "memory" && receipt.ok) clearSubmittedDraft();
  return receipt;
}

/**
 * queue/steer synchronously register the journal key before their first await,
 * so entry(key).stored() joins the same attempt. Normalization/storage failure
 * returns typed failures from both promises. Connections, not views, own
 * records and retry tasks. A locally retained request can later receive an
 * admission failure; keep that distinction visible rather than clearing intent.
 * Keyed commands, session creation and resource acquisition journal immutable
 * identity/body before transmission, with their own acknowledgement promises.
 * OperationsDirectory reconciles command receipts. Unknown write failures carry
 * identity even when the caller omitted key/id.
 *
 * Partitions bind HostId/principal/workspace/session/head at submit. Workspace
 * selection cannot clear another partition's flights. Retry only writes whose
 * contracts supply identity, never arbitrary writes or single-use streams via a
 * generic HTTP wrapper. Client close stops retries but keeps persistent records.
 * JournalProfile is chosen at connect, never detected from the runtime. Memory
 * profiles make no crash guarantee.
 * UI teardown stops observation, not queued delivery or remote work.
 *
 * Core defines snapshots/read models. Transport recovers cursors and applies
 * authoritative frames with the same pure core/view fold. Durable replay stays
 * ordered while its cursor is retained. Expiry/overflow sends reset + snapshot,
 * promising convergence, not every intermediate UI state. Mark lost transient
 * deltas as a gap and replace them with settlement. Pull/backpressure bounds
 * bytes. HTTP streaming uses bounded buffers and disconnect/rebase; WebSocket
 * RPC is not required. Session deltas, blobs, browser state and PTY output each
 * have their own policy.
 */

// 7. Files, changes, browser and terminal. Behavior in core, I/O in drivers.

interface WorkspaceHandle {
  readonly id: WorkspaceId;
  info(): Promise<Result<WorkspaceInfoView, RequestFailure>>;
  files(): Promise<Result<Capability<FilesApi>, RequestFailure>>;
  changes(): Promise<Result<Capability<ChangesApi>, RequestFailure>>;
  git(): Promise<Result<Capability<GitApi>, RequestFailure>>;
  browser(): Promise<Result<Capability<BrowserApi>, RequestFailure>>;
  terminals(): Promise<Result<Capability<TerminalsApi>, RequestFailure>>;
}
// Capability requests are O and may use negotiated cached descriptors. They
// do not start browsers/PTYs, trust folders or mount native views. Explicit
// outcomes distinguish unavailable capabilities from uninitialized ones.

interface FilesApi {
  scan(input?: {
    readonly directory?: string;
    readonly ignored?: "exclude" | "include";
  }): Promise<Result<FileTreeScan, ResourceOpenFailure>>; // A.
  read(path: string): Promise<Result<FileDocument, RequestFailure>>; // O small text or explicit binary/large.
  bytes(input: {
    readonly path: string;
    readonly expect: FileVersion;
  }): Promise<Result<ByteReader, ResourceOpenFailure>>; // A owned FD/response.
  save(input: {
    readonly path: string;
    readonly contents: string;
    readonly expect: FileVersion;
  }): Promise<Result<FileWriteResult, MutationFailure>>;
  format(input: {
    readonly path: string;
    readonly contents: string;
    readonly expect: FileVersion;
  }): Promise<Result<FormatResult, MutationFailure>>;
  search(input: {
    readonly query: string;
    readonly limit?: number;
  }): AsyncIterable<Result<SearchFrame, RequestFailure>>; // W ends with completeness.
  blame(path: string): Promise<Result<BlameResult, RequestFailure>>;
  watch(): AsyncIterable<Result<FileChangeFrame, RequestFailure>>; // W invalidation hints, not a transaction log.
  upload(
    source: AsyncIterable<Uint8Array>,
    options?: RequestOptions,
  ): Promise<Result<BlobId, MutationFailure>>; // O bounded streaming.
}
interface FileTreeScan extends Owned {
  pages(): AsyncIterable<
    Result<
      | { readonly kind: "entries"; readonly entries: readonly FileEntryView[] }
      | { readonly kind: "complete" }
      | { readonly kind: "incomplete"; readonly reason: "limit" | "changed" | "permission" },
      RequestFailure
    >
  >;
}
// Omitted directory = workspace root, not host root; omitted ignored = exclude.
// A truncated scan cannot report complete. Enumeration is not atomic under external
// edits. Run changes use a separate pinned immutable tree, FileSnapshotId.
interface ByteReader extends Owned {
  readonly version: FileVersion;
  readonly size: number;
  chunks(): AsyncIterable<Result<Uint8Array, RequestFailure>>; // W one consumer; close/return releases reader.
}
type FileDocument =
  | {
      readonly kind: "text";
      readonly path: string;
      readonly contents: string;
      readonly version: FileVersion;
    }
  | {
      readonly kind: "binary";
      readonly path: string;
      readonly size: number;
      readonly version: FileVersion;
    }
  | {
      readonly kind: "large";
      readonly path: string;
      readonly size: number;
      readonly version: FileVersion;
    }
  | { readonly kind: "missing"; readonly path: string };
type FileWriteResult =
  | { readonly kind: "saved"; readonly version: FileVersion }
  | { readonly kind: "conflict"; readonly current: FileVersion }
  | { readonly kind: "missing" }
  | { readonly kind: "partial"; readonly diagnostic: string };
// In-process locks cannot prevent external writes. Drivers must document
// single-path atomicity; there is no universal filesystem CAS guarantee.

interface ChangesApi {
  read(input: { readonly base: ChangeBase }): Promise<Result<ChangeRead, RequestFailure>>;
  batch(input: { readonly key: CommandKey }): FileBatch; // S immutable plan.
}
type ChangeBase =
  | { readonly kind: "working" }
  | { readonly kind: "staged" }
  | { readonly kind: "git-commit"; readonly commit: GitCommitId }
  | { readonly kind: "file-snapshots"; readonly from: FileSnapshotId; readonly to: FileSnapshotId };
type ChangeRead =
  | {
      readonly kind: "exact";
      readonly revision: FileSnapshotId;
      readonly files: readonly FileDelta[];
    }
  | { readonly kind: "unavailable"; readonly reason: string };
type ExpectedFile =
  | { readonly kind: "absent" }
  | { readonly kind: "version"; readonly version: FileVersion };
interface FileBatch {
  put(input: {
    readonly path: string;
    readonly blob: BlobId;
    readonly expect: ExpectedFile;
  }): FileBatch; // S new immutable plan.
  remove(input: { readonly path: string; readonly expect: FileVersion }): FileBatch; // S guarded delete.
  apply(): Promise<Result<Operation<FileBatchResult>, MutationFailure>>; // O durable command receipt.
}
type FileBatchResult =
  | {
      readonly kind: "applied";
      readonly snapshot: FileSnapshotId;
      readonly paths: readonly string[];
    }
  | { readonly kind: "conflict"; readonly paths: readonly string[] }
  | {
      readonly kind: "partial";
      readonly applied: readonly string[];
      readonly remaining: readonly string[];
      readonly diagnostic: string;
    }
  | { readonly kind: "stopped"; readonly applied: readonly string[] };
// Each path carries its checked expectation, including absence. Working-tree
// reports sample bytes, not a cross-path instant. A batch is one reviewed intent,
// not cross-file ACID. Record progress before advancing. Recovery compares
// expected/before/desired bytes and refuses external drift, rather than repeating
// writes/deletes blindly. Blobs are replayable; consumed upload streams are not.

interface ExactRunChanges {
  readonly kind: "exact";
  readonly run: RunId;
  readonly environment: EnvironmentId;
  readonly from: FileSnapshotId;
  readonly to: FileSnapshotId;
  readonly files: readonly FileDelta[];
}
type RunChanges =
  | ExactRunChanges
  | { readonly kind: "recorded"; readonly files: readonly FileDelta[] }
  | { readonly kind: "missing" };
type RestoreResult =
  | FileBatchResult
  | { readonly kind: "busy"; readonly runs: readonly RunId[] }
  | { readonly kind: "no-snapshot" }
  | { readonly kind: "environment-changed" };
// Restore requires exact evidence. Its to snapshot supplies per-path expected
// versions, with no separate expect. Core verifies the run's recorded trees and
// reconstructs paths rather than trusting a caller's list. It checks environment
// and all workspace Nyte writers, then uses the same file operation owner.
// External editors remain external. Restore changes neither conversation nor Git HEAD.

interface GitApi {
  snapshot(): Promise<
    Result<
      | {
          readonly kind: "repository";
          readonly revision: GitRevision;
          readonly head: GitCommitId | null;
        }
      | { readonly kind: "none" },
      RequestFailure
    >
  >;
  // head:null = unborn Git repository, not absent Git capability.
  diff(input: GitDiffInput): Promise<Result<readonly FileDelta[], RequestFailure>>;
  contents(input: GitContentsInput): Promise<Result<GitFileSides, RequestFailure>>;
  log(input?: {
    readonly cursor?: Cursor;
    readonly limit?: number;
  }): Promise<Result<Page<GitCommitView>, RequestFailure>>;
  refs(): Promise<Result<GitRefsView, RequestFailure>>;
  at(revision: GitRevision): GuardedGit; // S expectation binding, not checkout.
}
interface GuardedGit {
  stage(paths: readonly [string, ...string[]]): Promise<Result<GitMutation, MutationFailure>>;
  unstage(paths: readonly [string, ...string[]]): Promise<Result<GitMutation, MutationFailure>>;
  discard(paths: readonly [string, ...string[]]): Promise<Result<GitMutation, MutationFailure>>;
  commit(input: {
    readonly message: string;
    readonly files: "staged" | "all" | readonly [string, ...string[]];
  }): Promise<Result<GitMutation, MutationFailure>>;
  branch(input: {
    readonly name: string;
    readonly checkout: boolean;
  }): Promise<Result<GitMutation, MutationFailure>>;
  push(input: { readonly setUpstream: boolean }): Promise<Result<GitMutation, MutationFailure>>;
}
// O mutations consume, not update, the reviewed expectation. After success,
// read again before writing. branch->commit->push is not an atomic fluent chain;
// report each successful step. "none" differs from unsupported Git or denied access.
type GitMutation =
  | { readonly kind: "applied"; readonly revision: GitRevision }
  | { readonly kind: "unchanged" }
  | { readonly kind: "stale"; readonly revision: GitRevision }
  | { readonly kind: "busy"; readonly runs: readonly RunId[] }
  | { readonly kind: "rejected"; readonly reason: string };

async function applyFileBatch(
  sdk: Sdk,
  workspaceId: WorkspaceId,
  bytes: AsyncIterable<Uint8Array>,
) {
  const workspace = sdk.workspace(workspaceId);
  const filesResult = await workspace.files();
  if (!filesResult.ok) return filesResult;
  const files = filesResult.value;
  const changesResult = await workspace.changes();
  if (!changesResult.ok) return changesResult;
  const changes = changesResult.value;
  if (files.kind !== "available") return filesResult;
  if (changes.kind !== "available") return changesResult;
  const scanResult = await files.value.scan();
  if (!scanResult.ok) return scanResult;
  await using scan = scanResult.value;
  for await (const pageResult of scan.pages()) {
    if (!pageResult.ok) return pageResult;
    const page = pageResult.value;
    renderFileTreePage(page);
  } // observes incomplete marker.
  const baselineResult = await changes.value.read({ base: { kind: "working" } });
  if (!baselineResult.ok) return baselineResult;
  const baseline = baselineResult.value;
  if (baseline.kind !== "exact") return baselineResult;
  const blobResult = await files.value.upload(bytes);
  if (!blobResult.ok) return blobResult;
  const blob = blobResult.value;
  const destinationResult = await files.value.read("generated/output.bin");
  if (!destinationResult.ok) return destinationResult;
  const destination = destinationResult.value;
  const obsoleteResult = await files.value.read("generated/obsolete.bin");
  if (!obsoleteResult.ok) return obsoleteResult;
  const obsolete = obsoleteResult.value;
  const expect: ExpectedFile =
    destination.kind === "missing"
      ? { kind: "absent" }
      : { kind: "version", version: destination.version };
  const put = changes.value
    .batch({ key: sdk.keys.command() })
    .put({ path: "generated/output.bin", blob, expect });
  const plan =
    obsolete.kind === "missing"
      ? put
      : put.remove({ path: "generated/obsolete.bin", expect: obsolete.version });
  // Builders are S; only apply() mutates, without whole-filesystem CAS.
  const operationResult = await plan.apply();
  if (!operationResult.ok) return operationResult;
  const operation = operationResult.value;
  return await operation.settled();
}

interface BrowserApi {
  open(input: {
    readonly url: string;
    readonly owner: PageOwner;
    readonly key: CommandKey;
  }): Promise<Result<PageHold, ResourceOpenFailure>>; // A new page, scoped hold.
  adopt(id: PageId): Promise<Result<PageHold, ResourceOpenFailure>>; // A same page, not URL matching.
  list(): Promise<Result<readonly BrowserPageView[], RequestFailure>>;
  destroy(id: PageId): Promise<Result<{ readonly kind: "destroyed" | "missing" }, MutationFailure>>;
}
type PageOwner =
  | { readonly kind: "session"; readonly session: SessionId }
  | { readonly kind: "workspace" };
interface PageHold extends Owned {
  readonly id: PageId;
  state(): Promise<Result<BrowserPageStateView, RequestFailure>>;
  states(): AsyncIterable<Result<BrowserPageStateView, RequestFailure>>;
  snapshot(): Promise<Result<PageSnapshot, RequestFailure>>;
  navigate(url: string): Promise<Result<PageActionResult, MutationFailure>>;
  back(): Promise<Result<PageActionResult, MutationFailure>>;
  forward(): Promise<Result<PageActionResult, MutationFailure>>;
  reload(): Promise<Result<PageActionResult, MutationFailure>>;
  stopLoading(): Promise<Result<PageActionResult, MutationFailure>>; // not stop a run/page owner.
  at(revision: DocumentRevision): GuardedPage; // S selected document generation.
  wait(
    input: PageWait,
    options?: RequestOptions,
  ): Promise<Result<PageActionResult, RequestFailure>>;
  console(input?: {
    readonly limit?: number;
    readonly clear?: boolean;
  }): Promise<Result<readonly ConsoleEntryView[], RequestFailure>>;
  capture(): Promise<Result<ByteReader, ResourceOpenFailure>>; // A owned encoded image stream, not base64 by default.
  readonly unsafe: {
    evaluate(
      expression: string,
    ): Promise<
      Result<
        | { readonly kind: "value"; readonly value: Json }
        | { readonly kind: "threw"; readonly message: string },
        RequestFailure
      >
    >;
  };
}
interface PageSnapshot {
  readonly revision: DocumentRevision;
  readonly nodes: readonly {
    readonly ref: string;
    readonly role: string;
    readonly name: string;
    readonly editable: boolean;
  }[];
}
interface GuardedPage {
  click(input: {
    readonly ref: string;
    readonly expectedName: string;
    readonly button?: "left" | "right" | "middle";
    readonly double?: boolean;
  }): Promise<Result<PageActionResult, MutationFailure>>;
  type(input: {
    readonly ref: string;
    readonly expectedName: string;
    readonly text: string;
    readonly clear?: boolean;
    readonly submit?: boolean;
  }): Promise<Result<PageActionResult, MutationFailure>>;
  press(input: {
    readonly key: string;
    readonly ref?: string;
  }): Promise<Result<PageActionResult, MutationFailure>>;
  scroll(input: {
    readonly direction: "up" | "down" | "top" | "bottom";
    readonly ref?: string;
    readonly pages?: number;
  }): Promise<Result<PageActionResult, MutationFailure>>;
}
type PageWait =
  | { readonly kind: "loaded" }
  | { readonly kind: "text"; readonly text: string; readonly present: boolean }
  | { readonly kind: "delay"; readonly milliseconds: number };
type PageActionResult =
  | { readonly kind: "applied"; readonly snapshot: PageSnapshot }
  | { readonly kind: "stale-document" }
  | {
      readonly kind: "refused";
      readonly reason: "unknown-ref" | "occluded" | "not-visible" | "policy";
    }
  | { readonly kind: "closed"; readonly reason: "released" | "reclaimed" | "crashed" };
// close releases only this hold; a session hold can keep a page alive after tab
// close. Policy may reclaim hidden pages, reported as closed/reclaimed. Pages
// do not survive host death by default; persistent cookies do not preserve pages.
// Core browser operations verify expectedName and access policy for both SDK and
// tool calls. unsafe.evaluate needs full automation permission; it is not a read.

async function adoptPage(sdk: Sdk, workspaceId: WorkspaceId, pageId: PageId) {
  const capabilityResult = await sdk.workspace(workspaceId).browser();
  if (!capabilityResult.ok) return capabilityResult;
  const capability = capabilityResult.value;
  if (capability.kind !== "available") return capabilityResult;
  const pageResult = await capability.value.adopt(pageId);
  if (!pageResult.ok) return pageResult;
  await using page = pageResult.value;
  const snapshotResult = await page.snapshot();
  if (!snapshotResult.ok) return snapshotResult;
  const snapshot = snapshotResult.value;
  const button = snapshot.nodes.find((node) => node.role === "button" && node.name === "Submit");
  if (button !== undefined) {
    return await page.at(snapshot.revision).click({ ref: button.ref, expectedName: button.name });
  }
}
// A native viewport that shows the page is a driver adapter outside this
// contract; it alone owns bounds, occlusion, focus and screenshot fallback.
// A view stores PageId; URLs are content, never resource identity.

interface TerminalsApi {
  open(input: {
    readonly key: AcquisitionKey;
    readonly columns: number;
    readonly rows: number;
    readonly shell?: string;
  }): Promise<Result<PtyOwner, ResourceOpenFailure>>; // A.
  recover(key: AcquisitionKey): Promise<Result<PtyRecovery, ResourceOpenFailure>>; // A original owner or terminal fact.
  attach(id: TerminalId): Promise<Result<PtyView, ResourceOpenFailure>>; // A output attachment only.
}
type PtyRecovery =
  | { readonly kind: "owned"; readonly owner: PtyOwner }
  | { readonly kind: "ended"; readonly reason: "exited" | "expired" | "host-lost" }
  | { readonly kind: "missing" };
interface PtyOutput {
  readonly id: TerminalId;
  output(): AsyncIterable<Result<PtyFrame, RequestFailure>>;
}
type PtyFrame =
  | { readonly kind: "bytes"; readonly data: Uint8Array }
  | { readonly kind: "gap" }
  | { readonly kind: "exit"; readonly code: number | null };
interface PtyOwner extends PtyOutput, Owned {
  readonly ownership: "process";
  write(bytes: Uint8Array): Promise<Result<void, MutationFailure>>;
  resize(size: {
    readonly columns: number;
    readonly rows: number;
  }): Promise<Result<void, MutationFailure>>;
  idle(): Promise<Result<boolean, RequestFailure>>;
  ended(): Promise<
    Result<
      {
        readonly code: number | null;
        readonly reason: "exited" | "terminated" | "host-lost";
      },
      RequestFailure
    >
  >;
}
interface PtyView extends PtyOutput, Owned {
  readonly ownership: "view";
}
// These interfaces share output, not close semantics. Constructors preserve
// resource kind; an owner cannot safely substitute for a non-owning view.
// Host journals acquisition key/digest before spawn. Retry/recovery returns the
// original acquisition, never a second shell. Connections renew owner leases
// while owner scope is live. Lost replies and abrupt client loss expire within
// a configured bounded lease; recover fences stale owner callbacks. Permanent
// close releases owners; transient disconnect gets only reconnect grace.
// Host loss reports ended/host-lost. Never replay ambiguous starting intent as a
// fresh process under the same key. PtyOwner.close kills the shell and awaits
// cleanup; PtyView.close only detaches. Omitted shell = configured login shell;
// null is rejected. No arbitrary host cwd. code:null = no received exit status,
// not still running. IDs last for the host lifetime unless resumable PTYs are advertised.
// ACK bytes after renderer consumption. One owner stream supplies primary
// backpressure and can pause the PTY. Other views have independent bounded replay
// windows; slow views get gap without stalling owner or peers. Non-pausable
// drivers emit gap even for owners. Owners can read directly, without a second acquisition.

interface JobsApi {
  start(input: {
    readonly command: string;
    readonly key?: CommandKey;
  }): Promise<Result<JobHandle, MutationFailure>>;
  list(): Promise<Result<readonly JobView[], RequestFailure>>;
  get(id: JobId): JobHandle; // S no I/O.
}
interface JobHandle {
  readonly id: JobId;
  info(): Promise<Result<JobView, RequestFailure>>; // Addressed missing job is SdkFailure.missing.
  output(): AsyncIterable<Result<JobOutputFrame, RequestFailure>>;
  background(): Promise<Result<JobActionResult, MutationFailure>>;
  stop(): Promise<Result<JobActionResult, MutationFailure>>;
  settled(options?: RequestOptions): Promise<Result<JobEnd, RequestFailure>>;
}
// Jobs have durable command intent/result, not PTY ownership. Output tab
// open/close cannot stop them. Report processes lost on host shutdown; replay
// only when both recorded policy and environment permit it.

async function openTerminal(
  sdk: Sdk,
  workspace: WorkspaceId,
  consume: (bytes: Uint8Array) => Promise<void>,
) {
  const capabilityResult = await sdk.workspace(workspace).terminals();
  if (!capabilityResult.ok) return capabilityResult;
  const capability = capabilityResult.value;
  if (capability.kind !== "available") return capabilityResult;
  const ownerResult = await capability.value.open({
    key: sdk.keys.acquisition(),
    columns: 100,
    rows: 30,
  });
  if (!ownerResult.ok) return ownerResult;
  await using owner = ownerResult.value;
  const written = await owner.write(new TextEncoder().encode("pwd\r"));
  if (!written.ok) return written;
  for await (const frameResult of owner.output()) {
    if (!frameResult.ok) return frameResult;
    const frame = frameResult.value;

    if (frame.kind === "bytes") await consume(frame.data); // Demand resumes after consumption.
    if (frame.kind === "exit") break;
  }
}

// 8. Openers and connectors. Options describe dependencies; open acquires them.

interface HistoryRetentionPolicy {
  readonly leaseMs: number;
  readonly maxLifetimeMs: number;
  readonly maxReaders: number;
}
// All three are positive safe integers, hence finite and bounded.
// leaseMs <= maxLifetimeMs. A reader pins its selected graph only until the
// earlier of its lease deadline and openedAt + maxLifetimeMs. Renewal cannot
// extend the absolute lifetime. maxReaders bounds active reader pins per host;
// excess acquisitions return a typed capacity failure, never unbounded growth.
// Expired readers return snapshot-expired and release pins, including after
// client loss. Collection must honor active reader pins and durable references.
// Session admission/command receipts, withdrawal tombstones and key/digest
// evidence live for the session lifetime, including restart, compaction and archive.
// Workspace and host commands retain that evidence for their respective owner's
// lifetime; deleting a conversation cannot discard a file/Git command receipt.
// There is no automatic receipt expiry. Explicit owner destruction invalidates
// its addresses; a missing owner never permits replay or implicit resurrection.
// Closing a connection, changing workspaces or stopping a host is not deletion.

interface HostOpenOptions {
  readonly store: ResourceInput<NyteOptions["store"]>;
  readonly streamFn: NyteOptions["streamFn"];
  readonly models: ResourceInput<NyteOptions["models"]>;
  readonly model: NyteOptions["model"];
  readonly plugins: NyteOptions["plugins"];
  readonly defaultWorkspace: NyteOptions["defaultWorkspace"];
  readonly historyRetention: HistoryRetentionPolicy;

  readonly onDiagnostic?: NyteOptions["onDiagnostic"];
  readonly drain?: NyteOptions["drain"];
  readonly actor?: NyteOptions["actor"];
  readonly thinkingLevel?: NyteOptions["thinkingLevel"];
  readonly compaction?: NyteOptions["compaction"];
  readonly streamOptions?: NyteOptions["streamOptions"];
  readonly cacheWarming?: NyteOptions["cacheWarming"];
  readonly telemetry?: NyteOptions["telemetry"];
  readonly workspace?: NyteOptions["workspace"];
  readonly trust?: NyteOptions["trust"];
}
// These indexed types reuse the existing dependency contracts, not a second
// generic composition API. No constructor acquires resources implicitly.
// Grounding: NyteOptions requires store, streamFn, models, model, plugins and
// defaultWorkspace. HostOptions supplies catalog/streaming from MutableModels;
// that convenience does not make model execution or an initial model optional.
// streamFn and callbacks are borrowed. plugins are prepared definitions; core
// owns the connections, plugin tasks and pools it acquires during activation.
// Exactly one environment provider must serve defaultWorkspace.kind. Reject
// duplicate providers; local cwd must be absolute and workspace identity match.
// Project plugin loading stays behind trust. The source trust default remains
// trusted for defaultWorkspace, requires/workspace_trust for other workspaces.
// Core owns the vocabulary: WorkspaceTrust is the answer, WorkspaceTrustMode
// ("ask" | "always" | "never") is how a host reaches it. The host store applies
// the mode where no grant exists: "ask" trusts a folder without project input
// and asks for one with it; "always" trusts with the input; "never" trusts and
// marks TrustedWorkspace.projectInput false, so the folder runs on user plugins
// and skills alone and nothing asks. A user setting a project cannot set.
// Browser, PTY, files and Git are environment/plugin capabilities. Chat-only and
// nonlocal hosts need no universal browser driver, PTY driver or native service.
// These optional tuning fields retain source omission semantics; no new nulls.

interface NyteHost extends Owned {
  readonly sdk: Sdk;
  readonly execution: ExecutionApi;
  readonly admin: HostAdminApi;
  listen(options: ListenOptions): Promise<Result<Listener, ResourceOpenFailure>>; // A owns listener, borrows host.
}
interface NyteConnection extends Owned {
  readonly sdk: Sdk;
}
interface Listener extends Owned {
  readonly address: string;
  disconnectClients(): Promise<Result<void, MutationFailure>>; // Observation/requests, not durable runs.
}
declare const Nyte: {
  open(options: HostOpenOptions): Promise<Result<NyteHost, HostOpenFailure>>; // A acquires owned dependencies.
  connect(options: ConnectOptions): Promise<Result<NyteConnection, ConnectionFailure>>; // A handshake and journal worker.
};
type ConnectOptions = {
  readonly transport:
    | { readonly kind: "http"; readonly url: string; readonly fetch?: typeof fetch }
    | { readonly kind: "ipc"; readonly channel: ResourceInput<ClientChannel> };
  readonly credentials: CredentialSource;
  readonly journal: JournalProfile;
};
type JournalProfile =
  | { readonly kind: "memory" }
  | { readonly kind: "persistent"; readonly adapter: ResourceInput<RequestJournalAdapter> };
// No global journal or mutable selected host. Persistent adapters bind permanently
// to handshake HostId + authenticated principal. Stop workers before closing
// owned journal/channel; fetch and credential functions are borrowed. Client close
// does not sign out. Refresh preserves identity; host/principal changes require
// a new connection. Session selection is not a token or authorization boundary.

type ExecutionCoverage =
  | { readonly kind: "all" }
  | { readonly kind: "workspace"; readonly workspace: WorkspaceId }
  | { readonly kind: "sessions"; readonly sessions: readonly SessionId[] };
interface ExecutionApi {
  cover(input: ExecutionCoverage): Promise<Result<Owned, ResourceOpenFailure>>; // A includes future heads/children.
  advance(
    input: { readonly session: SessionId; readonly head: HeadName },
    options?: RequestOptions,
  ): Promise<Result<AdvanceReport, MutationFailure>>;
  repair(input: {
    readonly cursor?: Cursor;
    readonly limit: number;
  }): Promise<Result<RepairPage, MutationFailure>>;
}
type AdvanceReport =
  | { readonly kind: "continue" }
  | { readonly kind: "idle" }
  | { readonly kind: "waiting"; readonly until: number | null }
  | { readonly kind: "retry"; readonly until: number }
  | { readonly kind: "busy"; readonly until: number }
  | { readonly kind: "fenced" };
// until:null = durable wait without a timer; its wake obligation remains.
// All drivers share kernel reconciliation of jobs/delegation/input yields and
// the same advance, including local coverage, CF alarms and Vercel Workflow.
// all/workspace coverage includes future sessions and heads. Running listeners
// acquire coverage before accepting requests; close releases it, not durable
// Stop, and other coverage may remain. Admission-only listeners advertise
// uncovered; accepted work need not progress. Repair before following live wake
// events so pre-subscription events cannot strand work. Cloud schedulers persist
// the next repair obligation before releasing invocation. Dispatch is not
// completion; bounded runnable-head repair is required.

interface HostAdminApi {
  session(session: SessionId): SessionDiagnostics; // S binds identity; reads below perform I/O.
  relocate(input: {
    readonly session: SessionId;
    readonly workspace: WorkspaceId;
  }): Promise<Result<RelocateResult, MutationFailure>>;
  reactivate(): Promise<Result<void, MutationFailure>>;
  replacePlugins(
    input: PluginReplacementInput,
  ): Promise<Result<PluginReplacementResult, MutationFailure>>;
  checkPlugins(input: PluginReplacementInput): Promise<Result<PluginCheckReport, RequestFailure>>; // O same preflight, activates nothing.
  warming: CacheWarmingAdministration;
  retention: RetentionAdministration;
  readonly unsafe: HostUnsafe;
}
interface PluginReplacementInput {
  readonly key: CommandKey;
  readonly plugins: NyteOptions["plugins"];
  readonly session?: SessionId; // omit = host-wide; one session otherwise.
}
type PluginLoadOutcome =
  | {
      readonly kind: "activated";
      readonly plugin: PluginInfoView;
      readonly issues: readonly ValidationIssue[];
    }
  | { readonly kind: "rejected"; readonly id: string; readonly issues: readonly ValidationIssue[] }
  | {
      readonly kind: "kept-previous";
      readonly plugin: PluginInfoView;
      readonly issues: readonly ValidationIssue[];
    };
interface PluginReplacementResult {
  readonly key: CommandKey;
  readonly generation: CatalogGeneration;
  readonly plugins: readonly PluginLoadOutcome[];
}
interface PluginCheckReport {
  readonly plugins: readonly PluginLoadOutcome[];
  readonly counts: {
    readonly commands: number;
    readonly tools: number;
    readonly settings: number;
    readonly agents: number;
  };
  readonly collisions: readonly ValidationIssue[]; // warnings naming both owners.
}
// Load rules, per plugin: a declaration with an error issue is skipped and the
// rest of that plugin still activates; a plugin whose definition cannot be
// parsed at all is rejected, and on replacement its previous version stays
// active as kept-previous. The host never ends up with no plugins because one
// reload was bad. Issues that need the running host, such as a command name
// already owned by another plugin or a model the catalog lacks, are warnings
// in the check report and carry both sources. The check report is static: it
// runs the same preflight Nyte.open runs, without opening a database, reaching
// a provider or activating a session. Same-id replacement across sources
// (builtin < user < project < inline) is reported as a warning naming the
// shadowed plugin, never applied silently.
interface SessionDiagnostics {
  refs(): Promise<Result<readonly RefView[], RequestFailure>>;
  objects(input?: {
    readonly cursor?: Cursor;
  }): Promise<Result<Page<DecodedObjectView>, RequestFailure>>;
  events(input: { readonly after: Seq }): AsyncIterable<Result<DurableEventView, RequestFailure>>;
  verify(): Promise<Result<IntegrityReport, RequestFailure>>;
}
interface HostUnsafe {
  // Local only; requires host authority, not a remote capability bit.
  withStore<Success, Failure>(
    use: (store: StoreAuthority) => Promise<Result<Success, Failure>>,
  ): Promise<Result<Success, Failure | RequestFailure>>;
  withLease<Success, Failure>(
    input: { readonly session: SessionId; readonly head: HeadName },
    use: (lease: ExecutionLease) => Promise<Result<Success, Failure>>,
  ): Promise<Result<Success, Failure | RequestFailure>>;
}
// Escape hatches support storage-driver/tool/runtime authors, not pool classes,
// window internals, SQL strings or mutable cached rows. Raw writes can pass CAS
// yet violate SDK semantics. Examples require exclusive maintenance authority
// for repairs/adapters, not UI use. SessionDiagnostics, Store, Execution and
// HostAdmin are local-only. Remote /tree uses retained domain reads, not raw objects.
// HostUnsafe preserves the callback's failure union and does not classify thrown
// callback defects. It validates authority and acquires the lease before calling
// use; missing/busy ownership returns a failure without running the callback.
// These maintenance escapes never bypass storage fencing.

// Nyte.open first validates option schemas, retention bounds, duplicate provider
// registrations and local paths without opening a database or reaching a provider.
// Once a dependency opens, validate its identity/capabilities before using it.
// The host closes everything acquired on failure, in reverse dependency order.
// Expected setup failures return Result; rollback failures reject AggregateError
// containing the primary failure and all cleanup causes. No empty-store fallback.
// A borrowed dependency is never closed. Concurrent close calls share settlement.

interface HostCompositionInput {
  readonly database: string;
  readonly models: NyteOptions["models"];
  readonly streamFn: NyteOptions["streamFn"];
  readonly model: NyteOptions["model"];
  readonly workspace: NyteOptions["defaultWorkspace"];
  readonly plugins: NyteOptions["plugins"];
  readonly historyRetention: HistoryRetentionPolicy;
  readonly trust?: NyteOptions["trust"];
}
declare const Stores: {
  openSqlite(input: {
    readonly path: string;
  }): Promise<Result<NyteOptions["store"] & Owned, ResourceOpenFailure>>;
};

function composeHostOptions(input: HostCompositionInput): HostOpenOptions {
  return {
    store: { kind: "owned", open: () => Stores.openSqlite({ path: input.database }) },
    models: { kind: "borrowed", value: input.models },
    streamFn: input.streamFn,
    model: input.model,
    plugins: input.plugins,
    defaultWorkspace: input.workspace,
    historyRetention: input.historyRetention,
    ...(input.trust === undefined ? {} : { trust: input.trust }),
  };
}
// Substitute a borrowed Store, or an owned PostgreSQL/worker factory with the
// same typed contract. Platform SQLite stays borrowed. Owned PostgreSQL closes
// its pool. Catalog/provider tasks, MCP pools and telemetry acquired by core
// close with core; externally supplied objects keep their own lifetime.
// Nyte.open(composeHostOptions(input)) is the open example in section 1: S
// composition, then A acquisition and validation.

// A function names exactly the capability it needs. This is an ordinary
// parameter, not a required Handler<A, E, R> convention. Dependencies may also
// be constructor arguments or a closure where that is simpler.
async function narrowedDependency(
  sdk: Pick<Sdk, "session">,
  session: SessionId,
  content: UserContent,
  options: SubmitOptions,
): Promise<Result<AdmittedInput, AdmissionFailure>> {
  return sdk.session(session).queue(content, options);
}
// Core binds the canonical handlers to concrete store/model/policy dependencies.
// Local SDK calls and authorized listeners reach those same handlers. No fake
// local HTTP route, interpreter, service tags or implicit retry. Capture a key
// before retrying; a fresh invocation without a key is a fresh submission.

interface OperationResults {
  readonly navigate: NavigationOutcome;
  readonly edit: EditOutcome;
  readonly compact: CompactResult;
  readonly configure: ConfigurationReceipt;
  readonly "job-start": JobView;
  readonly "session-create": SessionInfoView;
  readonly branch: BranchRecord;
  readonly "file-save": FileWriteResult;
  readonly "git-write": GitMutation;
  readonly "plugin-setting": SettingResult;
  readonly "plugin-command": PluginCommandResult;
  readonly "plugin-replace": PluginReplacementResult;
  readonly "file-batch": FileBatchResult;
  readonly restore: RestoreResult;
}
// Excerpt of the generated result map, which includes every keyed declaration,
// including lifecycle/admin mutations. Results contain no JS methods; branch/job/create
// adapters bind returned domain IDs to handles after decoding stored results.
interface OperationsDirectory {
  find<K extends keyof OperationResults>(input: {
    readonly kind: K;
    readonly key: CommandKey;
  }): Promise<Result<Lookup<Operation<OperationResults[K]>>, RequestFailure>>;
}
// Stored command kind must match the requested kind; the schema validates it.
// All command kinds obey same-key/same-digest replay and KeyConflict otherwise.
// Core charges/retries summarization by the command record, not by UI request count.

type ListenOptions = {
  readonly transport: ServerTransport;
  readonly authorization: ServingPolicy;
  readonly execution:
    | { readonly kind: "run"; readonly coverage: ExecutionCoverage }
    | { readonly kind: "admit-only" };
};
type ResourceInput<T> =
  | { readonly kind: "borrowed"; readonly value: T }
  | {
      readonly kind: "owned";
      readonly open: () => Promise<Result<T & Owned, ResourceOpenFailure>>;
    };
// Constructors unwind partial acquisitions; borrowed objects never close implicitly.

type OperationDeclaration<Input, Output, Failure> = {
  readonly input: DomainSchema<Input>;
  readonly output: DomainSchema<Output>;
  readonly failure: DomainSchema<Failure>;
  readonly authority: "participant" | "execution" | "administration";
} & (
  | { readonly execution: "query" }
  | { readonly execution: "observation" }
  | {
      readonly execution: "mutation";
      readonly recovery: {
        readonly kind: "keyed";
        readonly identity: "submission" | "command" | "session" | "acquisition";
        readonly publication: "atomic" | "checkpointed" | "leased-acquisition";
      };
    }
  | {
      readonly execution: "mutation";
      readonly recovery: {
        readonly kind: "convergent";
        readonly state: DomainStateAddress;
      };
    }
  | { readonly execution: "volatile-action"; readonly retry: "never" }
);
// Mutations require recovery policy. Keyed handlers require normalized identity,
// even if the caller method mints it. The boundary journals, compares digests and
// preserves failure identity. Convergent writes such as seen marks need no receipt
// per scroll tick, but must converge on the declared state key. Never automatically
// replay volatile PTY input/resize or browser actions. Failures identify target/attempt;
// Read state before resending. Durable writes cannot be identity-free.
// This describes the catalog, not a schema framework. Use a concrete schema library
// with parsers as source of truth. Generate codecs, dispatch, client typings and
// capability metadata from domain declarations; explicitly adapt resource handles.
// Result error types and boundary codecs derive from the same failure schemas.
// Success schemas describe wire records, not resource handles. Generated adapters
// bind those records to local handles explicitly. Never serialize secrets,
// dependency objects, closures, AbortSignal or native objects.

interface EnvironmentProvider {
  provision(input: {
    readonly workspace: WorkspaceId;
    readonly key: CommandKey;
  }): Promise<Result<EnvironmentBinding, ResourceOpenFailure>>;
  connect(binding: EnvironmentBinding): Promise<Result<EnvironmentConnection, ResourceOpenFailure>>;
  suspend(binding: EnvironmentBinding): Promise<Result<void, MutationFailure>>;
  destroy(input: {
    readonly workspace: WorkspaceId;
    readonly binding: EnvironmentBinding | null;
  }): Promise<Result<void, MutationFailure>>;
}
interface EnvironmentConnection extends Owned {
  readonly id: EnvironmentId;
  readonly capabilities: EnvironmentCapabilities;
}
// provision adopts by stable workspace identity after crashes or competing creates.
// binding is serializable locator data without credentials, not a live handle.
// destroy binding:null = no recorded binding; find pre-crash resources by workspace
// identity and clean them. Connection close does not end billing. Local providers
// may reject destroy for user directories; host scope release never recursively
// removes a user's workspace.

// Connector ownership:
// - Stores.sqlite/worker/postgres: scope owns acquired connection/pool/worker.
// - Stores.from(connection): explicit borrowed or scoped factory, never infer.
// - Stores.cloudflare(storage): platform borrowed; host closes session views only.
// - Models.configured: provider transports and refresh tasks scoped; credentials
//   persist under a separate explicit store, no module-global auth mutation.
// - Plugins.from/source: parsed definitions + runtime scope; project load behind trust.
// - Mcp.open: stdio and streamable HTTP pools scoped; acquisition yields typed status.
// - Codemode.open: sandbox per invocation, parent scope supervises worker resources.
// - Telemetry.open: flush after execution settlement, then exporter shutdown.
// - Machine.open: provider sign-in/GitHub/settings/usage; account attempts scoped.
// - Broker.connect: account enrollment and verified device credential, not inference.
// - Relay.connect: socket/credits/leases, scope closes channels; never runs model work.
// - Listener.http/ipc: parsed authorized calls -> same core handlers, close leaves
//   accepted work intact. serve static web shell remains a host entry, not core.
// - CF driver: platform alarms + keyset repair + core advance, no permanent worker.
// - Vercel driver: Workflow waits + core advance + persistent repair; no early
//   deletion of the only work obligation when Workflow merely started.
// - Electron driver: browser/PTY implementations; viewport remains local adapter.
// - Remote sandbox: environment provider lifecycle above; explicit destroy owns cost.

interface ModelDirectory {
  // Lists base models only; a fast sibling rides on its base's row and is
  // selected through it. `default` may answer a sibling.
  list(): Promise<Result<readonly ModelInfoView[], RequestFailure>>;
  default(): Promise<Result<Lookup<ModelInfoView>, RequestFailure>>;
}
interface AdministrationCapabilities {
  machine(): Promise<Result<Capability<MachineApi>, RequestFailure>>;
}
interface MachineApi {
  readonly providers: ProviderAdministration;
  readonly github: GitHubAdministration;
  readonly settings: SettingsAdministration;
  readonly usage: UsageAdministration;
}
interface ProviderAdministration {
  catalog(): Promise<Result<ProviderCatalogView, RequestFailure>>;
  login(input: {
    readonly provider: string;
    readonly method: LoginChoice;
    readonly key: CommandKey;
  }): Promise<Result<LoginAttemptHandle, ResourceOpenFailure>>;
  logout(provider: string): Promise<Result<void, MutationFailure>>;
  preferences(change: ModelPreferenceChange): Promise<Result<ProviderCatalogView, MutationFailure>>;
}
interface LoginAttemptHandle extends Owned {
  readonly id: string;
  states(): AsyncIterable<Result<LoginAttemptView, RequestFailure>>;
  answer(code: string): Promise<Result<void, MutationFailure>>;
}
// Releasing the login handle cancels this attempt, not a saved account. Account connection
// grants neither workspace trust nor terminal/browser/credential access to all
// authenticated remote callers.

interface PluginReadApi {
  list(): Promise<Result<readonly PluginInfoView[], RequestFailure>>;
  readonly commands: {
    list(): Promise<Result<readonly CommandInfoView[], RequestFailure>>;
    run(input: {
      readonly name: string;
      readonly arguments?: string | Json; // text commands take a string; schema commands take Json.
      readonly key: CommandKey;
    }): Promise<Result<PluginCommandResult, CommandFailure>>;
  };
  readonly settings: {
    list(): Promise<Result<readonly SettingInfoView[], RequestFailure>>;
    apply(input: {
      readonly id: string;
      readonly choice: string;
      readonly key: CommandKey;
    }): Promise<Result<SettingResult, MutationFailure>>;
  };
  resources(): Promise<Result<readonly SkillView[], RequestFailure>>;
  status(): AsyncIterable<Result<readonly StatusItemView[], RequestFailure>>;
}
interface CommandInfoView {
  readonly name: string; // owner-qualified; bare names are the owner's own.
  readonly owner: string;
  readonly title: string; // palette text.
  readonly description: string;
  readonly category?: string;
  readonly keywords?: readonly string[];
  readonly arguments:
    | { readonly kind: "text" }
    | { readonly kind: "schema"; readonly schema: JsonSchema };
  readonly selection: "run" | "insert";
}
type PluginCommandResult =
  | { readonly kind: "ran"; readonly output?: Json }
  | { readonly kind: "prompt"; readonly prompt: UserContent }
  | { readonly kind: "failed"; readonly message: string };
interface SettingInfoView {
  readonly id: string;
  readonly owner: string;
  readonly label: string;
  readonly choices: readonly [SettingChoiceView, ...SettingChoiceView[]];
  readonly current: {
    readonly choice: string;
    readonly from: "default" | "host" | "session"; // the layer that set it.
  };
}
type SettingChoiceView = { readonly id: string; readonly label: string; readonly status?: string };
// A command is a typed action, not a free-text slash entry. arguments:text keeps
// today's `/name rest of line`; arguments:schema lets the palette, CLI and
// remote callers reject a bad call as invalid-input with issues before run,
// e.g. `no argument named "bogus"; the command takes file, ratio?`. Commands
// are keyed mutations: a nested run from inside a command reuses the parent's
// key space and nests at most 16 deep. Two plugins declaring one name is a
// warning naming both; the later source wins, as with plugin ids. Missing name
// is unavailable, not not_found. Only hosts register plugins; remote
// listing/commands cannot upload JS. Schemas define tool arguments/results.
// Declarations persist; executable closures remain installed code. Each call
// supplies its tool environment. Settings that affect requests are captured
// into the input choice at admission; from says which layer a client is
// changing when it applies a choice.

function defineTool() {
  return Tool.define({
    name: "read_file",
    parameters: Schemas.readFile,
    result: Schemas.fileDocument,
    failure: Schemas.fileReadFailure,
    replay: { kind: "safe", environment: "same" },
    execute: (arguments_, invocation) => invocation.files.read(arguments_.path),
  });
}
// Invocation supplies exact run/call/env identity, deadline/signal, durable wait,
// progress and policy-routed nested tools. It expires at invocation end; detached
// callbacks cannot publish through stale leases. Uncertain external effects require
// replay never, not default safe. Waiting stores generation/data; wake re-enters code,
// not a JS continuation. Nested tools use model-issued calls' policy. Typed extension
// methods still require parsed authorization.

// Delegation is a core invocation capability, not an untyped participant route.
type InvocationFiles = Pick<FilesApi, "read">;

interface ToolInvocation {
  readonly run: RunId;
  readonly call: CallId;
  readonly environment: EnvironmentId;
  readonly signal: AbortSignal;
  readonly agents: DelegationApi;
  readonly tools: PolicyRoutedTools;
  readonly files: InvocationFiles;
}
interface DelegationApi {
  create(input: {
    readonly key: CommandKey;
    readonly title?: string;
    readonly system?: string;
    readonly configuration?: InputChoice;
  }): Promise<Result<ChildAgent, ConfigurationFailure>>;
  task(input: {
    readonly key: CommandKey;
    readonly prompt: UserContent;
    readonly configuration?: InputChoice;
    readonly waitMs?: number;
  }): Promise<Result<ChildTaskObservation, AdmissionFailure>>;
  get(child: SessionId): ChildAgent; // S lineage checked when used; no new child.
  join(input: {
    readonly children: readonly SessionId[];
    readonly mode: "any" | "all";
    readonly timeoutMs: number;
  }): Promise<Result<ChildObservation, RequestFailure>>;
}
interface ChildAgent {
  readonly id: SessionId;
  send(input: {
    readonly key: SubmissionKey;
    readonly message: UserContent;
    readonly waitMs?: number;
  }): Promise<Result<ChildTaskObservation, AdmissionFailure>>;
  read(input?: { readonly turns?: number }): Promise<Result<ChildObservation, RequestFailure>>;
  stop(input: { readonly run: RunId }): Promise<Result<StopResult, MutationFailure>>;
}
interface ChildTaskObservation {
  readonly child: SessionId;
  readonly admission: AdmissionRecord;
  readonly observation: ChildObservation;
}
type ChildObservation =
  | { readonly kind: "working"; readonly run: RunId }
  | { readonly kind: "waiting" }
  | { readonly kind: "settled"; readonly report: UserContent }
  | { readonly kind: "deadline" };
// create links a child session, not a conversation branch or history copy. Core
// records parent run/call, child request and a one-time continuation grant. Child
// completion alone cannot restart the parent. Parent Stop revokes the grant but
// leaves child work running unless explicitly stopped by exact identity.
// join parks a durable effect generation, not a JS continuation. Invocation
// methods return closed after end; later invocations reacquire by child ID. Serialized
// closures cannot transfer authority. Delegated input obeys configuration, chain
// budget, replay environment and same-key digest rules; fresh roots cannot evade
// budget. System/title/choice/waitMs/turns default when omitted, never accept null.
// timeoutMs is required, not undefined for "wait forever". Participants check
// children and use exact-run controls; only verified invocations can grant
// automatic parent continuation.

function delegateFromTool(invocation: ToolInvocation, key: CommandKey, prompt: UserContent) {
  return invocation.agents.task({ key, prompt, waitMs: 30_000 });
}
// Plugin tools and custom host invocations share DelegationApi. Existing
// task/create/send/await/read/stop descriptions become adapters, not exclusive access.

// 9. Nullability and chaining contract.
//
// Optional request fields
//   SubmitOptions.key                mint once; repeated SDK call is new input.
//   SubmitOptions.history            capture observed epoch; otherwise preflight read, never retry rebind.
//   SubmitOptions.configuration      capture selected choice in admission CAS.
//   configuration.kind                required patch|exact discriminant.
//   ExactChoice agent:null            built-in agent value, not a reset.
//   ExactChoice policy version        required and validated, never discarded.
//   ChoicePatch.model                keep current model; null rejected.
//   ChoicePatch.thinking / agent      keep override; null explicitly clears it.
//   requestPolicy.settings            keep; provided registered choices merged and validated.
//   Sessions.create.id/name/workspace default as documented; null rejected.
//   Session.update.name              keep if omitted; null clears title.
//   Session.update booleans          unchanged if omitted; null rejected.
//   list cursor/limit/parents         first page/default bound/all if omitted.
//   pending.revise fields            retain each omitted value; no null accepted.
//   compaction/acquisition key        required; lost replies reconcile by key.
//   summary instructions            host default summarization instructions.
//   files directory/ignored/limit    workspace root/exclude/default bound.
//   browser button/double/clear/submit left/false/false/false.
//   browser ref/pages/console.limit  viewport/default page distance/default cap.
//   browser console.clear            false; true is an explicit buffer mutation.
//   terminals.shell                  configured login shell.
//   RequestOptions.signal            no caller signal; never durable Stop.
//   Connect HTTP fetch               standard fetch adapter.
// Optional TS values do not serialize as undefined. Encoders omit optional members.
//
// Unknown members and variants
//   Request schemas reject unknown members as invalid-input. A misspelled
//   argument is an error, never ignored.
//   Views and frames tolerate unknown members: a client ignores fields it does
//   not know, so a newer host can add data without breaking older clients.
//   An unknown discriminant is a whole-frame problem. A client skips that frame
//   or view and refetches; it never coerces an unknown kind into one it knows,
//   so a state added later cannot read as an older state. Event names are not
//   checked against a list; subscribing to a name this host never emits is
//   allowed and receives nothing.
//   Settings files and plugin storage read per key: a bad value falls back for
//   that key alone and unknown keys are kept on write.
//
// Known nullable facts
//   page.next                        end of pagination.
//   HistoryNode.parent               conversation root.
//   ResolvedChoice.agent             built-in/default agent.
//   ExecutionView.idle.last          no previous run.
//   ParkedWait.deadline              no timer.
//   NavigationOutcome.summary        no summary published.
//   post-stop failure.stoppedRun     no preceding Stop committed.
//   SessionView selected/effective     no selected configuration/no effective request yet.
//   not-attempted identity             no write identity minted, not an unknown write.
//   DeliveryEntry.state()            no locally journaled record.
//   Git.snapshot.head                unborn Git repository.
//   PTY code                         no exit code observed.
//   EnvironmentProvider.destroy.binding no stored reconnect locator.
//   SessionView/HeadInfoView.unseen  nothing drawn after the seen mark.
//   HeadInfoView.stack               not stacked.
//   TurnView.run / failure           seeded or foreign turn / ended normally.
//   user part key / source           sender gave no key / unattributed.
//   tool part result / output        no result commit landed / returned nothing.
// None means loading, unsupported, or "please choose a default" unless explicitly
// declared as a patch clear operation above.
//
// Chain-now S
//   sdk.session(id).head(name).run(id); sdk.workspace(id); page.at(revision);
//   git.at(revision); changes.batch(...).put(...).remove(...); ID parsing and host option construction.
//   .head takes a parsed SideHeadName; main is already the session handle.
//   .branch is not chain-now. It mutates named history and returns an outcome.
// Await-first A
//   Nyte.open/connect; sessions.create; observe/tree; files.bytes/scan;
//   browser.open/adopt; terminals.open/attach; listener and execution.cover.
// Outcome O
//   queue/steer/configure; branch; navigation/edit admission; every guarded write;
//   stop/reply/input.withdraw; markSeen; lookup/state reads; operation.settled/graph.renew.
// Stream W
//   observation.frames/events; graph.pages; scan.pages; bytes.chunks;
//   file watch/search; browser.states; PTY/job output; login states.
// No lazy-program category. Operations start when called. Builders remain
// immutable values until their documented apply/open call.
//
// Invalid chains and substitutions:
//   Nyte.open(options).sdk              // await acquisition first.
//   (await Nyte.open(options)).sdk      // narrow Result, then use value.sdk.
//   sdk.session(id).queue(text).stop()   // Promise is not AdmittedInput or Run.
//   (await session.queue(text)).runId   // narrow Result; receipt still has no run until landing.
//   session.branch(...).queue(text)     // narrow created outcome, then head.
//   git.at(oldRevision).stage(...).push(...) // a receipt is not a fresh revision.
//   sdk.workspace(id).browser?.open(...) // no optional namespace.
//   closeView()                         // never shorthand for run.stop().
//   anchors.set(head, view.seen)        // a seen mark is not a scroll position.
//
// Export policy
//   Export domain capabilities, driver contracts, pure projections, parsers and
//   documented diagnostic and maintenance escapes needed by custom hosts, not private
//   caches/pools. Callers need no runner callback knowledge after parking tools.
//   Broad domain access does not require more resource owners.
