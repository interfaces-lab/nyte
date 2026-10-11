import type { Authority, Disposer, HostView, PrincipalId } from "@nyte-ai/schema";
import type { Kernel } from "./kernel.ts";
import { closable, coalesce, latest } from "./watch.ts";

/** Returns the `HostView` fields the composing host supplies and changes: catalog generation, plugins, settings, operations. */
export type HostViewFields = Pick<HostView, "catalog" | "plugins" | "settings" | "operations">;

/** Holds the host-level fields `watchHost` yields; whoever composes the host updates them. */
export interface HostState {
  /** Returns the current fields. */
  current(): HostViewFields;
  /** Replaces the given fields and notifies every subscriber. */
  update(patch: Partial<HostViewFields>): void;
  /** Adds a host-level row of issues no plugin runtime owns (§43e: decision 12's unknown or invalid seeded settings under `settings`, a plugin file that did not load or was dropped, §41j): merged by id into `plugins` (a known id gains the issues, a new id is appended after the plugin rows), kept for the state's life so every later `update` that replaces `plugins` merges it again, and every subscriber notified. A second report with the same id replaces the first. */
  report(row: HostViewFields["plugins"][number]): void;
  /** Calls the listener after every update; the disposer stops it. */
  subscribe(listener: (fields: HostViewFields) => void): Disposer;
}

/** Returns a host state holding the initial fields. Reported rows are kept apart from the plugin rows `update` sets, so each `update` merges them into a fresh copy and a row's issues never repeat. */
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
      reports.set(row.id, row);
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
