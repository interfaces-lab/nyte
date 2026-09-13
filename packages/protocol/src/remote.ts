/**
 * The SDK as a remote client sees it: the operation table rendered as the same
 * namespaces `Nyte` has, restricted to the operations the wire carries.
 * `@nyte-ai/client` implements it over HTTP; a test double can implement it
 * in memory.
 */
import type { SessionEvent, WatchInput } from "./sdk.ts";
import type { Operation, OperationInput, OperationOutput } from "./operations.ts";

/** One operation as a method. The input parameter is optional when the operation accepts none. */
export type OperationFn<V extends Operation> =
  undefined extends OperationInput<V>
    ? (input?: OperationInput<V>) => Promise<OperationOutput<V>>
    : (input: OperationInput<V>) => Promise<OperationOutput<V>>;

export interface RemoteSessions {
  readonly create: OperationFn<"sessions.create">;
  readonly get: OperationFn<"sessions.get">;
  readonly snapshot: OperationFn<"sessions.snapshot">;
  readonly metadata: OperationFn<"sessions.metadata">;
  readonly list: OperationFn<"sessions.list">;
  readonly rename: OperationFn<"sessions.rename">;
  readonly setPinned: OperationFn<"sessions.setPinned">;
  readonly setArchived: OperationFn<"sessions.setArchived">;
  readonly delete: OperationFn<"sessions.delete">;
  readonly configure: OperationFn<"sessions.configure">;
}

export interface RemoteMessages {
  readonly send: OperationFn<"messages.send">;
  readonly cancel: OperationFn<"messages.cancel">;
  readonly redeliver: OperationFn<"messages.redeliver">;
}

export interface RemoteRuns {
  readonly current: OperationFn<"runs.current">;
  readonly abort: OperationFn<"runs.abort">;
  readonly reply: OperationFn<"runs.reply">;
  readonly changes: OperationFn<"runs.changes">;
}

export interface RemoteJobs {
  readonly list: OperationFn<"jobs.list">;
  readonly start: OperationFn<"jobs.start">;
  readonly background: OperationFn<"jobs.background">;
  readonly cancel: OperationFn<"jobs.cancel">;
}

export interface RemoteHeads {
  readonly move: OperationFn<"heads.move">;
}

export interface RemoteWorkspace {
  readonly list: OperationFn<"workspace.list">;
  readonly forget: OperationFn<"workspace.forget">;
  readonly vcs: {
    readonly diff: OperationFn<"workspace.vcs.diff">;
  };
}

export interface RemoteProvider {
  readonly models: {
    readonly list: OperationFn<"provider.models.list">;
    readonly default: OperationFn<"provider.models.default">;
  };
}

export interface RemotePlugins {
  readonly catalog: OperationFn<"plugins.catalog">;
  readonly list: OperationFn<"plugins.list">;
  readonly commands: {
    readonly list: OperationFn<"plugins.commands.list">;
    readonly run: OperationFn<"plugins.commands.run">;
  };
  readonly settings: {
    readonly list: OperationFn<"plugins.settings.list">;
    readonly apply: OperationFn<"plugins.settings.apply">;
  };
  readonly resources: {
    readonly list: OperationFn<"plugins.resources.list">;
  };
  readonly status: {
    readonly list: OperationFn<"plugins.status.list">;
  };
}

export type RemoteWatchInput = WatchInput & { readonly signal?: AbortSignal };

export interface RemoteNyte {
  /** The landing policy in force on the host: the lanes `messages.send` may name. */
  readonly landing: OperationFn<"landing">;
  readonly sessions: RemoteSessions;
  readonly messages: RemoteMessages;
  readonly runs: RemoteRuns;
  readonly jobs: RemoteJobs;
  readonly heads: RemoteHeads;
  readonly workspace: RemoteWorkspace;
  readonly provider: RemoteProvider;
  readonly plugins: RemotePlugins;
  /**
   * Replay after `afterSeq` (or from the start), or begin live at the tip;
   * `synced` arrives once either way. Ends when the caller's signal aborts or
   * the iterator is returned. Throws a `cursor_expired` error when the cursor
   * is below the floor: take `sessions.snapshot` and watch from its `seq`.
   */
  watch(input: RemoteWatchInput): AsyncIterable<SessionEvent>;
}
