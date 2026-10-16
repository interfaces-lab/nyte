/**
 * Nyte SDK reference.
 *
 * These examples compile against the packages they describe. Handles and
 * records come from core and schema through SDK exports; this file does not
 * maintain a second set of declarations.
 *
 * Acquisition throws SdkError. Commands return discriminated outcomes.
 * A handle binds synchronously, and its operations check existence. Watch
 * streams yield folded views; iteration throws if the stream breaks.
 *
 * Run `pnpm --dir packages/lab typecheck` to check this reference along with
 * the lab browser, host and video code.
 */
import { definePart, isPart, memoryStore, text, tool } from "@nyte-ai/core";
import { asId, asSeq, standard } from "@nyte-ai/schema";
import { createSendJournal, sdk, SdkError } from "@nyte-ai/sdk";
import type {
  Connection,
  ConnectOptions,
  EnvironmentProvider,
  ExecutionEnv,
  FilesApi,
  Head,
  Host,
  Job,
  Json,
  MessageId,
  SendOptions,
  OpenHostOptions,
  Part,
  Plugin,
  PluginApi,
  Renderer,
  Resources,
  Session,
  SessionEvent,
  SessionId,
  Store,
  ToolDefinition,
  ToolInvocation,
  Workspace,
} from "@nyte-ai/sdk";
import { Type } from "typebox";


/**
 * A plugin accepts Standard Schema validators. TypeBox crosses that boundary
 * through `standard`, and schema inference supplies the tool's arguments.
 */
export const labelSchema = standard(Type.Object({ label: Type.String({ minLength: 1 }) }));

export type Label = NonNullable<(typeof labelSchema)["~standard"]["types"]>["output"];


/**
 * Node composes a host with `sdk.open`. The host supplies local execution,
 * first-party plugins, persistence and credentials unless options replace
 * them. Its close stops its own execution and listeners. A caller-supplied
 * store remains the caller's responsibility.
 *
 * The browser uses `sdk.connect`; its `open` rejects unavailable. Both entry
 * points return the same Connection handle tree. A custom fetch can serve
 * an in-process listener without opening a socket.
 */
export async function openHost(options: OpenHostOptions): Promise<Host> {
  return sdk.open(options);
}

/**
 * ConnectOptions carries URL, credentials, optional identity expectation,
 * fetch and journal. Persist a journal for sends that must survive the
 * client's restart; createSendJournal keeps retries across link loss only.
 */
export async function connect(options: ConnectOptions): Promise<Connection> {
  return sdk.connect({ journal: createSendJournal(), ...options });
}

/**
 * Every connection owns sessions, workspaces, models, settings, plugins and
 * principals. Host.watch yields the current catalog, plugin issues and
 * settings. Model operations include refresh, verify, login and logout.
 * Secrets stay behind the credentials boundary.
 */
export async function readHost(connection: Connection) {
  const [sessions, workspaces, models] = await Promise.all([
    connection.sessions.list({ limit: 50 }),
    connection.workspaces.list(),
    connection.models.list(),
  ]);

  return { sessions, workspaces, models };
}

/**
 * Owner connections can list saved provider logins and select the account
 * used by subsequent requests. Usage reads share a cache and refresh only
 * expired provider data; catalog reads never fetch usage.
 */
export async function readProviderUsage(connection: Connection, provider: string) {
  const accounts = await connection.models.accounts(provider);
  const alternative = accounts.find((account) => !account.active);

  if (alternative !== undefined) await connection.models.selectAccount(provider, alternative.id);

  return connection.models.usage();
}


/**
 * A Session extends the main Head and adds management, heads, runs,
 * receipts and parts. Directory rows use `id`; handles use `id` and
 * `sessionId`. A head name is branded at the boundary.
 *
 * Configure takes a ConfigurationPatch. A send can pin its own exact
 * Configuration. `thinking` names effort, and `agent` selects a declared
 * agent. No parallel messages, runs or heads namespaces exist on Connection.
 */
export async function startSession(connection: Connection, name: string): Promise<Session> {
  const session = await connection.sessions.create({ name });
  await session.send("Explain the current change.", { delivery: "queue" });

  return session;
}

/**
 * Receipt ids are minted inside. Supply an `id` only when retrying across
 * your own restart. The same id and content replay one admission. `landed`
 * waits for placement; `settled` waits for the run's end. Aborting that wait
 * leaves the run working. `stop` withdraws a queued input or stops its run.
 */
export async function retrySend(session: Session, savedId: string) {
  const receipt = await session.send("Explain the current change.", {
    id: asId<"receipt">(savedId),
    delivery: "queue",
  });

  return { id: receipt.id, message: receipt.message, status: await receipt.status() };
}

/**
 * Editing replaces a MessageId with the new input. A landed edit can stop
 * the active run, move history and retain or summarize the abandoned path.
 * `expect` comes from a current view. When its revision is null, read again
 * before editing so the mutation keeps its concurrency check.
 */
export async function editMessage(session: Session, message: MessageId, content: string) {
  const view = await session.view();

  const options = { replace: message, running: "stop" } satisfies SendOptions;

  if (view.revision === null)
    throw new SdkError("unavailable", "The revision is unavailable. Read the view again.");

  return session.send(content, { ...options, expect: view.revision });
}

/**
 * A fork starts at a Position, either start or a commit. Read a source
 * head's tree to get its current tip. A created head inherits history;
 * configure its model and effort before sending if they must match a cache.
 * Merge returns busy while its parent has a live run. Removing a head keeps
 * commits reachable from other heads.
 */
export async function forkHead(session: Session, source: Head, name: string) {
  const headName = asId<"head">(name);
  const tree = await source.tree();
  const outcome = await session.heads.create(headName, { from: tree.tip });

  if (outcome.kind !== "created" && outcome.kind !== "exists") return outcome;
  const head = session.head(headName);
  const configuration = (await source.view()).configuration.effective;

  if (configuration !== null) await head.configure(configuration);

  return head;
}

/**
 * The view owns conversation order, turns, execution, configuration,
 * background work, changes and the catalog. Idle carries lastRun; a live
 * execution carries run and phase. Read history before a MessageId when a
 * bounded tail needs older messages. Tree nodes expose the commit DAG.
 */
export async function readConversation(head: Head) {
  const view = await head.view({ tail: 100 });

  const answers = view.messages.flatMap((message) =>
    isPart(message, text) ? [message.state.markdown] : [],
  );

  const tools = view.messages.flatMap((message) =>
    isPart(message, tool) && message.state.phase === "settled" ? [message.state.outcome] : [],
  );

  return { view, answers, tools };
}

/** Runs and reacquired receipts bind without I/O, just like sessions. */
export function reacquire(session: Session, runId: string, receiptId: string) {
  return {
    run: session.run(asId<"run">(runId)),
    receipt: session.receipt(asId<"receipt">(receiptId)),
  };
}


/**
 * A part definition owns a state schema, action schemas and a fallback.
 * Built-in text, thinking and tool parts use the same view shape. isPart
 * narrows the unknown state using the definition. A renderer belongs to a
 * client plugin; its fallback reaches clients without that renderer.
 */
export const note = definePart({
  kind: "lab/reference-note",
  state: labelSchema,
  actions: { acknowledge: { input: standard(Type.Object({})) } },
  fallback: (state) => state.label,
});

/**
 * A modal part's first action answers it. A non-modal part is never
 * answered, so answer resolves null at once. RequestOptions.signal ends an
 * unanswered wait. Update's optional version performs compare-and-set;
 * stale means nothing changed. Built-in parts reject client mutation.
 */
export async function showNote(session: Session): Promise<Part<typeof note>> {
  const part = await session.parts.create(note, {
    state: { label: "Review this change." },
    placement: { kind: "modal" },
  });

  const updated = await part.update({ label: "Review the new revision." }, { version: 1 });

  if (updated.kind !== "updated")
    throw new SdkError("stale", `The note update returned ${updated.kind}.`);
  await part.answer({ signal: AbortSignal.timeout(30_000) });

  return part;
}


/**
 * Workspaces register targets and return a WorkspaceId. Inspect reveals
 * availability and project sources before add. A session names the
 * registered id. Files, git and browser return a discriminated capability;
 * inspect its kind before using api.
 */
export async function registerWorkspace(connection: Connection, path: string) {
  const outcome = await connection.workspaces.add({ kind: "local", path });

  if (outcome.kind !== "added" && outcome.kind !== "exists") return outcome;

  return connection.workspace(outcome.workspace);
}

/**
 * File operations use workspace-relative paths. Writes and immutable batch
 * plans support expected versions. Upload stores bytes and returns a BlobId;
 * a batch consumes it through `{ blob }`. Apply returns a receipt, whose
 * outcome reports applied, stale, partial or stopped. Streams provide scan,
 * search, watch and byte reads.
 */
export async function writeFiles(files: FilesApi) {
  return files.write("notes.txt", "Review notes\n", { parents: true });
}

/** The blob descriptor is distinct from ordinary text containing its id. */
export async function writeUploadedFile(files: FilesApi, source: AsyncIterable<Uint8Array>) {
  const blob = await files.upload(source);
  const receipt = await files.batch().put({ path: "attachment.bin", contents: { blob } }).apply();

  return receipt.settled();
}

/**
 * Git reads expose status, refs, log, blame, changes, file sides and streamed
 * patches. Writes stage, unstage, discard, commit, branch and push, each with
 * a GitOutcome. Writes can use GitWrite.expect from the revision the user saw.
 */
export async function readGit(workspace: Workspace) {
  const capability = await workspace.git();

  if (capability.kind !== "available") return capability;

  return capability.api.status();
}

/**
 * Jobs start through workspace.jobs or an invocation environment. A Job
 * exposes input, output frames, resize, idle, settled and stop. Job directory
 * rows come from workspace.jobs.list/watch. Output frames keep
 * order; view streams may coalesce. The job's state owns its end reason.
 */
export async function readJob(job: Job) {
  return { id: job.id, idle: await job.idle() };
}

/**
 * Browser pages expose snapshots with refs, actions with optional expected
 * document revisions, navigation, console, capture and evaluate. They close
 * explicitly or with async disposal. Missing browser capability is an
 * outcome, so a chat-only environment needs no dummy browser.
 */
export async function readBrowser(workspace: Workspace) {
  const capability = await workspace.browser();

  if (capability.kind !== "available") return capability;
  const page = await capability.api.open({ url: "https://nyte.sh/docs" });

  try {
    return await page.snapshot();
  } finally {
    await page.close();
  }
}


/**
 * Core scans resources once per workspace generation. Plugins receive
 * inputs with user/project files, skills, context files and prompt sources.
 * Project resources follow the registered workspace's setting. Plugins read
 * api.inputs instead of rescanning the raw filesystem.
 */
export function readResources(api: PluginApi<"core">): Resources {
  return api.inputs;
}

/**
 * An EnvironmentProvider owns inspect and attach for one target kind. Its
 * ExecutionEnv owns cwd, files, exec and close. Optional git, snapshots and
 * browser capabilities remain absent when unsupported. wrapEnv can add a
 * capability for a desktop without changing a tool's contract.
 */
export type Environment = {
  readonly provider: EnvironmentProvider;
  readonly attached: ExecutionEnv;
};


/**
 * Tools declare Standard Schema parameters, an optional output schema, a
 * class, workspace effects and replay policy. Results use kind text/file,
 * typed output and optional part ids. A tool invocation receives the real
 * session, connection, workspace and environment, plus progress and tool
 * access.
 */
export const labelTool: ToolDefinition<Label> = {
  name: "reference_label",
  description: "Return a label.",
  parameters: labelSchema,
  class: () => ({ kind: "custom", label: "Label" }),
  effects: "none",
  replay: "safe",
  async execute(input) {
    return { content: [{ kind: "text", text: input.label }] };
  },
};

/**
 * Durable work uses memo, now and wait. A replay sees the memoized JSON;
 * wait parks for a part, run, job, timer or a group. Do not substitute
 * process-local promises when an execution driver must resume the work.
 */
export async function durableLabel(invocation: ToolInvocation): Promise<Json> {
  return invocation.memo("label", () => ({ at: invocation.now(), label: "Review" }));
}


/**
 * A Plugin is a plain object checked with satisfies, with static contribute
 * arrays, hooks and optional activate. Registries add static or derived
 * items and return disposers. Observe hooks report, transforms return a new
 * value and decide hooks return continue, modify, reject or error.
 *
 * A command's caller is the principal whose authority its api uses. Agents
 * select model, prompt and allowed tool names. Settings declare schemas and
 * scope; a plugin reads its values through its own settings registry.
 */
export const referencePlugin = {
  id: "lab-reference",
  contribute: {
    tools: [labelTool],
    parts: [note],
    settings: [
      {
        id: "lab-reference.enabled",
        label: "Enable labels",
        schema: standard(Type.Boolean()),
        default: true,
        scope: "session",
      },
    ],
    commands: [
      {
        name: "label",
        title: "Add label",
        description: "Send a label request.",
        run: (_args, { caller }) => ({ prompt: `Label this change for ${caller}.` }),
      },
    ],
  },
  hooks: {
    before_tool: () => ({ action: "continue" }),
  },
} satisfies Plugin<"core">;

/**
 * Client plugins declare renderers for a part kind and framework, palette
 * commands, settings and keybindings. api.session is the one on screen,
 * or null. App lifecycle hooks and before_submit belong to the client side;
 * core hooks and environment access cannot be used by a client plugin.
 */
export const noteRenderer: Renderer<typeof note, string> = {
  kind: note,
  framework: "text",
  render: ({ state }) => state.label,
};


/**
 * schema owns records and validators. core owns handles, composition,
 * admission, execution, folds, stores and plugin contracts. host composes
 * Node persistence, environment providers and listeners. protocol owns the
 * operation table and transport codecs. sdk owns connection retries,
 * journals and client folds. plugin ships core and client plugins.
 *
 * Import SDK handles and records from @nyte-ai/sdk. Import definePart,
 * isPart and built-in part definitions from @nyte-ai/core. A plugin imports
 * its side-specific Plugin type from @nyte-ai/plugin/core or /client.
 */
export type SdkRoot = typeof sdk;


/**
 * A Store opens one StoreConnection with content-addressed objects, blobs
 * and compare-and-set refs. RefStore.set publishes an atomic batch with its
 * durable events. Store has no backend kind property. The provider owns its
 * connection and closes the store explicitly.
 * StoreConnection.sessions indexes current roots by activity and parent,
 * and outstanding work by session. Each refs.set updates those projections
 * atomically; list rows carry a separate version for all changes to that
 * session, while the ref retains its compare-and-set revision.
 */
export function temporaryStore(): Store {
  return memoryStore();
}

/**
 * Host adds inspect and execution to Connection. Inspect exposes refs,
 * decoded objects, durable events and integrity verification. Execution
 * covers sessions, advances one head and repairs owed work for drivers.
 * Participant, owner and maintenance authority belongs to the authenticated
 * principal, enforced by served operations. Pairing creates reconnectable
 * device credentials; revoke closes that principal's live connections.
 */
export async function inspectSession(
  host: Host,
  session: SessionId,
): Promise<readonly SessionEvent[]> {
  const events: SessionEvent[] = [];

  for await (const event of host.inspect(session).events({ after: asSeq(0) })) events.push(event);

  return events;
}


/**
 * Durable events carry seq and at. The same fold builds host and SDK views.
 * Part-created/updated/settled and answered events own part state; run
 * events own execution. A patch is transient text or progress, so resumed
 * streams seed their current state before yielding new patches.
 *
 * SdkError is the one acquisition, defect and transport error. Domain
 * outcomes remain values. Catch at the application boundary and keep the
 * error code; do not wrap every internal operation in another result type.
 */
export function errorMessage(cause: unknown): string {
  return cause instanceof SdkError ? `${cause.code}: ${cause.message}` : String(cause);
}

export default sdk;
