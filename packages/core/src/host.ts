import type {
  AdvanceReport,
  Authority,
  Awaitable,
  Cursor,
  DecodedObjectView,
  Disposer,
  ExecutionCoverage,
  HeadName,
  HostDescription,
  HostId,
  HostView,
  IdentityChallenge,
  IntegrityReport,
  Owned,
  Paged,
  PrincipalId,
  PruneReport,
  Ref,
  RepairPage,
  Seq,
  SessionEvent,
  SessionId,
} from "@nyte-ai/schema";
import type { Connection, PluginFile, PluginsApi } from "./connection.ts";
import type { Kernel } from "./kernel.ts";
import type { Plugin } from "./plugin.ts";
import { closable, coalesce, latest } from "./watch.ts";

export interface Host extends Connection {
  listen(options: ListenOptions): Promise<Listener>;
  readonly plugins: PluginsApi<Plugin<"core"> | PluginFile>;
  prune(): Promise<PruneReport>;
  inspect(session: SessionId): {
    refs(): Promise<readonly Ref[]>;
    objects(input?: { readonly cursor?: Cursor }): Promise<Paged<DecodedObjectView>>;
    events(input: { readonly after: Seq }): AsyncIterable<SessionEvent>;
    verify(): Promise<IntegrityReport>;
  };
  readonly execution: {
    cover(coverage: ExecutionCoverage): Promise<Owned>;
    advance(input: { readonly session: SessionId; readonly head: HeadName }): Promise<AdvanceReport>;
    repair(input: { readonly cursor?: Cursor; readonly limit: number }): Promise<RepairPage>;
  };
}

export interface ListenOptions {
  readonly transport:
    | { readonly kind: "http"; readonly hostname?: string; readonly port?: number }
    | { readonly kind: "fetch" };
  readonly auth:
    | { readonly kind: "token"; readonly token: string }
    | { readonly kind: "custom"; authorize(request: Request): Awaitable<{ readonly principal: PrincipalId; readonly authority: ReadonlySet<Authority> } | { readonly deny: "unauthorized" | "forbidden" }> };
  readonly execution?: { readonly kind: "run"; readonly coverage: ExecutionCoverage } | { readonly kind: "admit-only" };
  readonly origins?: readonly string[];
  readonly maxBodyBytes?: number;
  readonly identity?: { readonly id: HostId; sign(nonce: string): Awaitable<IdentityChallenge> };
  readonly describe?: () => Awaitable<HostDescription>;
  before?(request: Request): Awaitable<Response | undefined>;
}

export interface Listener {
  readonly address: string | null;
  fetch(request: Request): Promise<Response>;
  disconnectClients(): void;
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}


/** Returns the `HostView` fields the composing host supplies and changes: catalog generation, plugins, settings, operations. */
export type HostViewFields = Pick<HostView, "catalog" | "plugins" | "settings" | "operations">;

/** Holds the host-level fields `watchHost` yields; whoever composes the host updates them. */
export interface HostState {
  /** Returns the current fields. */
  current(): HostViewFields;
  /** Replaces the given fields and notifies every subscriber. */
  update(patch: Partial<HostViewFields>): void;
  /** Adds a host-level row of issues no plugin runtime owns (§43e), merged by id into `plugins` for the state's life; a report with no issues withdraws it (§49a). */
  report(row: HostViewFields["plugins"][number]): void;
  /** Calls the listener after every update; the disposer stops it. */
  subscribe(listener: (fields: HostViewFields) => void): Disposer;
}

/** Returns a host state holding the initial fields, its reported rows kept apart so each `update` merges them into a fresh copy. */
export function createHostState(initial: HostViewFields): HostState {
  let base = initial.plugins;
  const reports = new Map<string, HostViewFields["plugins"][number]>();
  let fields = initial;
  const listeners = new Set<(fields: HostViewFields) => void>();

  const publish = (patch: Partial<HostViewFields>): void => {
    base = patch.plugins ?? base;
    fields = { ...fields, ...patch, plugins: mergeReports(base, reports) };

    for (const listener of listeners) listener(fields);
  };

  return {
    current: () => fields,
    update: publish,
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    report(row) {
      if (row.issues.length === 0) reports.delete(row.id);
      else reports.set(row.id, row);
      publish({});
    },
  };
}

/** Returns the plugin rows with every reported row merged by id: a known id gains the reported issues, an unknown one is appended in report order. */
function mergeReports(
  plugins: HostViewFields["plugins"],
  reports: ReadonlyMap<string, HostViewFields["plugins"][number]>,
): HostViewFields["plugins"] {
  if (reports.size === 0) return plugins;
  const known = new Set(plugins.map((row) => row.id));

  return [
    ...plugins.map((row) => {
      const reported = reports.get(row.id);

      return reported === undefined ? row : { ...row, issues: [...row.issues, ...reported.issues] };
    }),
    ...[...reports.values()].filter((row) => !known.has(row.id)),
  ];
}

/** Yields the host view whenever it changes: the one host-level stream. `return()` unsubscribes at once. */
export function watchHost(
  kernel: Kernel,
  input: { readonly principal: PrincipalId; readonly authority: ReadonlySet<Authority> },
): AsyncIterable<HostView> {
  return closable<HostView>(() => {
    const updates = coalesce(latest(kernel.host.current(), (push) => kernel.host.subscribe(push)))[
      Symbol.asyncIterator
    ]();

    return {
      async pull() {
        const next = await updates.next();

        if (next.done) return next;
        const fields = next.value;

        return {
          done: false,
          value: {
            id: kernel.hostId,
            link: { kind: "connected" },
            name: kernel.description.name,
            platform: kernel.description.platform,
            version: kernel.description.version,
            catalog: fields.catalog,
            plugins: fields.plugins,
            settings: fields.settings,
            authority: input.authority,
            operations: fields.operations,
          },
        };
      },
      close() {
        void updates.return?.();
      },
    };
  });
}
