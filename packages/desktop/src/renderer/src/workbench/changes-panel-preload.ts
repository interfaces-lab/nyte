import type { VcsDiff, VcsLog, VcsRefs, VcsSnapshot } from "@nyte-ai/protocol";
import type { NyteBridge } from "../../../shared/ipc.ts";

export const STAGED = "src/staged.ts";

export const WORKING = "src/working.ts";

export const COMMITTED = "src/committed.ts";

export const COMMIT_OID = "c0ffee0badc0ffee";

export const BINARY_OID = "b1a0000";

export const PENDING_OID = "de1a000";

export const pendingCommit = Promise.withResolvers<readonly VcsDiff[]>();

const patchOf = ({
  path,
  added,
  removed,
}: {
  readonly path: string;
  readonly added: number;
  readonly removed: number;
}): string => {
  const oldLines = Array.from({ length: removed }, (_, index) => `-old ${String(index + 1)}`);
  const newLines = Array.from({ length: added }, (_, index) => `+new ${String(index + 1)}`);

  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${String(removed)} +1,${String(added)} @@`,
    ...oldLines,
    ...newLines,
    "",
  ].join("\n");
};

const repository: VcsSnapshot = {
  kind: "repository",
  root: "changes-panel-repo",
  revision: "revision-1",
  head: {
    kind: "attached",
    oid: COMMIT_OID,
    branch: "main",
    upstream: null,
    base: null,
  },
  staged: [{ path: STAGED, kind: "added" }],
  unstaged: [{ path: WORKING, kind: "modified" }],
};

const diff: NyteBridge["workspace"]["vcs"]["diff"] = async (input) => {
  if (input.scope.kind === "commit" && input.scope.oid === PENDING_OID)
    return pendingCommit.promise;

  if (input.scope.kind === "commit" && input.scope.oid === BINARY_OID) {
    return [
      {
        path: "image.png",
        status: "modified",
        kind: "binary",
        patch:
          "diff --git a/image.png b/image.png\nindex 1234567..7654321 100644\nBinary files a/image.png and b/image.png differ\n",
      },
    ];
  }

  const entries =
    input.scope.kind === "commit"
      ? [{ path: COMMITTED, added: 2, removed: 1 }]
      : input.scope.kind === "staged"
        ? [{ path: STAGED, added: 3, removed: 0 }]
        : input.scope.kind === "unstaged"
          ? [{ path: WORKING, added: 1, removed: 2 }]
          : [
              { path: STAGED, added: 3, removed: 0 },
              { path: WORKING, added: 1, removed: 2 },
            ];

  const paths =
    input.paths === undefined
      ? entries
      : entries.filter((entry) => input.paths?.includes(entry.path));

  return paths.map((entry) => ({
    path: entry.path,
    status: "modified",
    kind: "text",
    added: entry.added,
    removed: entry.removed,
    patch: patchOf(entry),
  }));
};

const log = async (): Promise<VcsLog> => ({ commits: [], hasMore: false });

const refs = async (): Promise<VcsRefs> => ({ local: ["main"], remote: [] });

Object.defineProperty(window, "nyte", {
  configurable: true,
  value: {
    sessions: { snapshot: () => new Promise(() => {}) },
    watch: () => () => {},
    workspace: {
      vcs: {
        snapshot: async () => repository,
        diff,
        log,
        refs,
        contents: async () => ({ kind: "text", contents: "" }),
      },
    },
    host: {
      state: () => new Promise(() => {}),
      catalog: () => new Promise(() => {}),
      setThemePreference: () => {},
      files: { list: async () => [] },
    },
    plugins: { catalog: () => new Promise(() => {}) },
  },
});
