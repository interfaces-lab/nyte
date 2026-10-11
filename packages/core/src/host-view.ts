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
  /** Adds a host-level row of issues no plugin runtime owns (§43e: decision 12's unknown or invalid seeded settings under `settings`, a plugin file that did not load or was dropped, §41j): merged by id into `plugins` (a known id gains the issues, a new id is appended after the plugin rows), kept for the state's life so every later `update` that replaces `plugins` merges it again, and every subscriber notified. */
  report(row: HostViewFields["plugins"][number]): void;
  /** Calls the listener after every update; the disposer stops it. */
  subscribe(listener: (fields: HostViewFields) => void): Disposer;
}

/** Returns a host state holding the initial fields. */
export function createHostState(initial: HostViewFields): HostState {
  let fields = initial;
  const listeners = new Set<(fields: HostViewFields) => void>();

  return {
    current: () => fields,
    update(patch) {
      fields = { ...fields, ...patch };

      for (const listener of listeners) listener(fields);
    },
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    report() {
      throw new Error("not implemented");
    },
  };
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
