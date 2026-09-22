// Standalone browser-test preload for the changes panel's revert route.
// Import before any renderer module reads window.nyte.
import type {
  VcsDiscardOutcome,
  VcsLog,
  VcsRefs,
  VcsSnapshot,
  VcsWorktreeFile,
} from "@nyte-ai/protocol";
import type { NyteBridge } from "../../../shared/ipc.ts";

export const TRACKED = "src/working.ts";

export const UNTRACKED = "scratch.txt";

const patchOf = (path: string): string =>
  [`--- a/${path}`, `+++ b/${path}`, "@@ -1 +1,2 @@", " old", "+new", ""].join("\n");

/** The scripted working tree, plus what the panel asked of it. */
interface RevertScript {
  files: VcsWorktreeFile[];
  revision: number;
  snapshotReads: number;
  diffReads: number;
  reverts: { readonly paths: readonly string[] }[];
  /** Answers the next revert with this skip reason instead of reverting. */
  skipReason: string | undefined;
}

export const revertScript: RevertScript = {
  files: [
    { path: TRACKED, kind: "modified" },
    { path: UNTRACKED, kind: "untracked" },
  ],
  revision: 1,
  snapshotReads: 0,
  diffReads: 0,
  reverts: [],
  skipReason: undefined,
};

const vcsSnapshot = async (): Promise<VcsSnapshot> => {
  revertScript.snapshotReads += 1;

  return {
    kind: "repository",
    root: "changes-revert-repo",
    revision: `revision-${String(revertScript.revision)}`,
    head: {
      kind: "attached",
      oid: "c0ffee0",
      branch: "main",
      upstream: null,
      base: null,
    },
    staged: [],
    unstaged: revertScript.files,
  };
};

const diff: NyteBridge["workspace"]["vcs"]["diff"] = async (input) => {
  revertScript.diffReads += 1;

  return (input.paths ?? revertScript.files.map((file) => file.path)).map((path) => ({
    path,
    status: "modified",
    kind: "text",
    added: 1,
    removed: 0,
    patch: patchOf(path),
  }));
};

const discard: NyteBridge["workspace"]["vcs"]["discard"] = async (
  input,
): Promise<VcsDiscardOutcome> => {
  revertScript.reverts.push({ paths: input.paths });
  const reason = revertScript.skipReason;

  if (reason !== undefined) {
    revertScript.skipReason = undefined;

    return { kind: "applied", paths: [], skipped: input.paths.map((path) => ({ path, reason })) };
  }

  // A discarded file leaves the working tree, which the next status read reports.
  revertScript.files = revertScript.files.filter((file) => !input.paths.includes(file.path));
  revertScript.revision += 1;

  return { kind: "applied", paths: [...input.paths], skipped: [] };
};

const log = async (): Promise<VcsLog> => ({ commits: [], hasMore: false });

const refs = async (): Promise<VcsRefs> => ({ local: ["main"], remote: [] });

Object.defineProperty(window, "nyte", {
  configurable: true,
  value: {
    sessions: { snapshot: () => new Promise(() => {}) },
    watch: () => () => {},
    workspace: { vcs: { snapshot: vcsSnapshot, diff, log, refs, discard } },
    host: {
      state: () => new Promise(() => {}),
      catalog: () => new Promise(() => {}),
      setThemePreference: () => {},
      files: { list: async () => [] },
    },
    plugins: { catalog: () => new Promise(() => {}) },
  },
});
