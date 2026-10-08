/** One working tree, shared by every changes-tab variant. Totals match the reference screenshot: +737 −793. */
export type FileStatus = "modified" | "added" | "deleted";

export interface ChangedFile {
  readonly path: string;
  readonly added: number;
  readonly removed: number;
  readonly status: FileStatus;
  readonly staged: boolean;
}

export const FILES: readonly ChangedFile[] = [
  { path: ".vercelignore", added: 24, removed: 16, status: "modified", staged: true },
  {
    path: "packages/app/src/workbench/changes-panel.tsx",
    added: 312,
    removed: 288,
    status: "modified",
    staged: true,
  },
  {
    path: "packages/app/src/workbench/changes-toolbar.tsx",
    added: 140,
    removed: 201,
    status: "modified",
    staged: false,
  },
  {
    path: "packages/app/src/workbench/change-scopes.ts",
    added: 96,
    removed: 0,
    status: "added",
    staged: false,
  },
  {
    path: "packages/app/src/workbench/stacked-diff.ts",
    added: 0,
    removed: 182,
    status: "deleted",
    staged: false,
  },
  { path: "packages/ui/src/row.tsx", added: 165, removed: 106, status: "modified", staged: false },
];

export const TOTAL = FILES.reduce(
  (sum, file) => ({ added: sum.added + file.added, removed: sum.removed + file.removed }),
  { added: 0, removed: 0 },
);

export const BRANCH = { name: "daniel/schema", ahead: 2, behind: 0 } as const;

export const MESSAGE = "Fix tab close behavior";

export function splitPath(path: string): { readonly dir: string; readonly base: string } {
  const slash = path.lastIndexOf("/");

  return slash === -1
    ? { dir: "", base: path }
    : { dir: path.slice(0, slash), base: path.slice(slash + 1) };
}

/** A tree of folders, one level deep: enough to mock grouping without a real trie. */
export function byFolder(): readonly {
  readonly dir: string;
  readonly files: readonly ChangedFile[];
}[] {
  const groups = new Map<string, ChangedFile[]>();

  for (const file of FILES) {
    const { dir } = splitPath(file.path);
    groups.set(dir, [...(groups.get(dir) ?? []), file]);
  }

  return [...groups].map(([dir, files]) => ({ dir, files }));
}
