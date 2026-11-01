import type { HostView, ValidationIssue } from "@nyte-ai/schema";
import type { Kernel } from "../contract/kernel.ts";

type View = HostView["views"][number];

/**
 * The first plugin to declare a kind wins. A view that fails keeps its last good build and is
 * reported on its plugin's row, so a typo mid-edit leaves parts drawn.
 */
export async function publishViews(kernel: Kernel): Promise<void> {
  const compile = kernel.plugins.compileView;

  if (compile === null) return;
  const claimed = new Set<string>();

  const declared = [...kernel.plugins.builtins, ...kernel.plugins.host].flatMap((plugin) =>
    (plugin.contribute?.parts ?? []).flatMap((part) => {
      if (part.view === undefined || claimed.has(part.kind)) return [];
      claimed.add(part.kind);

      return [{ plugin: plugin.id, kind: part.kind, view: part.view }];
    }),
  );

  const built = await Promise.all(
    declared.map(async (entry) => ({ ...entry, build: await compile(entry.view) })),
  );

  const published = kernel.host.current().views;

  const views = (
    await Promise.all(
      built.map(async (entry): Promise<View | undefined> => {
        const build = entry.build;

        if (build.kind === "failed")
          return published.find((view) => view.kind === entry.kind && view.plugin === entry.plugin);

        return {
          kind: entry.kind,
          plugin: entry.plugin,
          runtime: build.runtime,
          blob: await kernel.store.objects.putBlob(encoded(build.code)),
        };
      }),
    )
  ).filter((view) => view !== undefined);

  const failures = Map.groupBy(
    built.flatMap((entry): { readonly plugin: string; readonly issue: ValidationIssue }[] =>
      entry.build.kind === "failed"
        ? [
            {
              plugin: entry.plugin,
              issue: {
                severity: "error",
                path: ["parts", entry.kind, "view"],
                message: `The ${entry.kind} view did not compile: ${entry.build.message}`,
                source: { plugin: entry.plugin, file: decodeURI(entry.view.pathname) },
              },
            },
          ]
        : [],
    ),
    (failure) => failure.plugin,
  );

  reportFailures(kernel, failures);

  if (
    views.length !== published.length ||
    views.some((view, index) => {
      const before = published[index];

      return (
        before?.kind !== view.kind ||
        before.plugin !== view.plugin ||
        before.runtime !== view.runtime ||
        before.blob !== view.blob
      );
    })
  )
    kernel.host.update({ views });
}

function reportFailures(
  kernel: Kernel,
  failures: ReadonlyMap<string, readonly { readonly issue: ValidationIssue }[]>,
): void {
  const rows = new Map(kernel.host.current().plugins.map((row) => [row.id, row]));

  const row = (id: string) => {
    const known = rows.get(id);

    return known === undefined
      ? { id, source: "inline" as const, path: null }
      : { id, source: known.source, path: known.path };
  };

  for (const id of kernel.plugins.state.viewFailures)
    if (!failures.has(id)) kernel.host.report({ ...row(id), issues: [] });

  for (const [id, entries] of failures)
    kernel.host.report({ ...row(id), issues: entries.map((entry) => entry.issue) });

  kernel.plugins.state.viewFailures = [...failures.keys()];
}

async function* encoded(code: string): AsyncIterable<Uint8Array> {
  yield new TextEncoder().encode(code);
}
