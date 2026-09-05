/**
 * The SDK as a remote client sees it: the verb table rendered as the same
 * namespaces `Nyte` has, restricted to the verbs the wire carries.
 * `@nyte-ai/client` implements it over HTTP; a test double can implement it
 * in memory.
 */
import type { SessionEvent, WatchInput } from "./sdk.ts";
import type { Verb, VerbInput, VerbOutput } from "./verbs.ts";

/** One verb as a method. The input parameter is optional when the verb accepts none. */
export type VerbFn<V extends Verb> =
  undefined extends VerbInput<V>
    ? (input?: VerbInput<V>) => Promise<VerbOutput<V>>
    : (input: VerbInput<V>) => Promise<VerbOutput<V>>;

export interface RemoteSessions {
  readonly create: VerbFn<"sessions.create">;
  readonly get: VerbFn<"sessions.get">;
  readonly snapshot: VerbFn<"sessions.snapshot">;
  readonly list: VerbFn<"sessions.list">;
  readonly rename: VerbFn<"sessions.rename">;
  readonly setPinned: VerbFn<"sessions.setPinned">;
  readonly setArchived: VerbFn<"sessions.setArchived">;
  readonly delete: VerbFn<"sessions.delete">;
  readonly configure: VerbFn<"sessions.configure">;
}

export interface RemoteMessages {
  readonly send: VerbFn<"messages.send">;
  readonly cancel: VerbFn<"messages.cancel">;
  readonly redeliver: VerbFn<"messages.redeliver">;
}

export interface RemoteRuns {
  readonly abort: VerbFn<"runs.abort">;
  readonly changes: VerbFn<"runs.changes">;
}

export interface RemoteHeads {
  readonly move: VerbFn<"heads.move">;
}

export interface RemoteWorkspace {
  readonly list: VerbFn<"workspace.list">;
  readonly forget: VerbFn<"workspace.forget">;
  readonly vcs: {
    readonly diff: VerbFn<"workspace.vcs.diff">;
  };
}

export interface RemoteProvider {
  readonly models: {
    readonly default: VerbFn<"provider.models.default">;
  };
}

export interface RemotePlugins {
  readonly catalog: VerbFn<"plugins.catalog">;
  readonly list: VerbFn<"plugins.list">;
  readonly commands: {
    readonly list: VerbFn<"plugins.commands.list">;
    readonly run: VerbFn<"plugins.commands.run">;
  };
  readonly settings: {
    readonly list: VerbFn<"plugins.settings.list">;
    readonly apply: VerbFn<"plugins.settings.apply">;
  };
  readonly resources: {
    readonly list: VerbFn<"plugins.resources.list">;
  };
}

export type RemoteWatchInput = WatchInput & { readonly signal?: AbortSignal };

export interface RemoteNyte {
  /** The landing policy in force on the host: the lanes `messages.send` may name. */
  readonly landing: VerbFn<"landing">;
  readonly sessions: RemoteSessions;
  readonly messages: RemoteMessages;
  readonly runs: RemoteRuns;
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
