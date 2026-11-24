import { Type } from "typebox";
import { useEffect, useSyncExternalStore } from "react";
import { persisted } from "../lib/storage.ts";

const NONE: Readonly<Record<string, readonly string[]>> = {};

const stored = persisted(
  "nyte:code:commit-checks",
  Type.Record(Type.String(), Type.Array(Type.String())),
  NONE,
);

/** The files a person checked for the next commit. Nyte keeps them per project and branch; git's index never sees them. */
export interface CommitChecks {
  readonly checked: ReadonlySet<string>;
  readonly toggle: (path: string, checked: boolean) => void;
  readonly setAll: (checked: boolean) => void;
}

/** The checks for `key`, kept only for `paths`, the files that still have changes. */
export function useCommitChecks(key: string, paths: readonly string[]): CommitChecks {
  const all = useSyncExternalStore(stored.subscribe, stored.get);
  const listed = new Set<string>(paths);
  const kept = all[key] ?? [];
  const checked = new Set(kept.filter((path) => listed.has(path)));

  const write = (next: ReadonlySet<string>): void => {
    const rest = Object.fromEntries(
      Object.entries(stored.get()).filter((entry) => entry[0] !== key),
    );

    stored.set(next.size === 0 ? rest : { ...rest, [key]: [...next] });
  };

  const pruned = checked.size !== kept.length;

  // oxlint-disable-next-line nyte-code/no-direct-effect -- a file that loses its changes must lose its check before it can change again
  useEffect(() => {
    if (pruned) write(checked);
  });

  return {
    checked,
    toggle: (path, on) => {
      const next = new Set(checked);

      if (on) next.add(path);
      else next.delete(path);
      write(next);
    },
    setAll: (on) => write(on ? listed : new Set()),
  };
}
