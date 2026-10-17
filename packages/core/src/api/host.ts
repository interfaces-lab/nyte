import type { Authority, HostView, PrincipalId } from "@nyte-ai/schema";
import type { HostState, HostViewFields } from "../contract/host.ts";
import type { Kernel } from "../contract/kernel.ts";
import { closable, coalesce, latest } from "../util/iterable.ts";

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
            defaultWorkspace: fields.defaultWorkspace,
            authority: input.authority,
          },
        };
      },
      close() {
        void updates.return?.();
      },
    };
  });
}
