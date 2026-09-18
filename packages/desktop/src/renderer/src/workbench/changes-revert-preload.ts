// Standalone browser-test preload for the changes panel's revert route.
// Import before any renderer module reads window.nyte.
import type { VcsStatus } from "@nyte-ai/protocol";
import type {
  DesktopVcsLog,
  DesktopVcsRefs,
  DesktopVcsRevert,
  DesktopVcsSnapshot,
  NyteBridge,
} from "../../../shared/ipc.ts";

export const TRACKED = "src/working.ts";
export const UNTRACKED = "scratch.txt";

const patchOf = (path: string): string =>
  [`--- a/${path}`, `+++ b/${path}`, "@@ -1 +1,2 @@", " old", "+new", ""].join("\n");

/** The scripted working tree, plus what the panel asked of it. */
interface RevertScript {
  files: VcsStatus["files"];
  revision: number;
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
  reverts: [],
  skipReason: undefined,
};

const vcsSnapshot = async (): Promise<DesktopVcsSnapshot> => ({
  kind: "repository",
  repositoryId: "changes-revert-repo",
  revision: `revision-${String(revertScript.revision)}`,
  status: { branch: "main", files: revertScript.files },
  head: { oid: "c0ffee0", branch: "main", ahead: 0, behind: 0 },
  staged: [],
  unstaged: revertScript.files,
});

const scopedDiff: NyteBridge["host"]["vcs"]["diff"] = async (input) =>
  (input.paths ?? revertScript.files.map((file) => file.path)).map((path) => ({
    path,
    patch: patchOf(path),
  }));

const revert: NyteBridge["host"]["vcs"]["revert"] = async (input): Promise<DesktopVcsRevert> => {
  revertScript.reverts.push({ paths: input.paths });
  const reason = revertScript.skipReason;
  if (reason !== undefined) {
    revertScript.skipReason = undefined;
    return { reverted: [], skipped: input.paths.map((path) => ({ path, reason })) };
  }
  // A reverted file leaves the working tree, which the next status read reports.
  revertScript.files = revertScript.files.filter((file) => !input.paths.includes(file.path));
  revertScript.revision += 1;
  return { reverted: [...input.paths], skipped: [] };
};

const log = async (): Promise<DesktopVcsLog> => ({ commits: [], hasMore: false });
const refs = async (): Promise<DesktopVcsRefs> => ({
  current: "main",
  local: ["main"],
  remote: [],
});

Object.defineProperty(window, "nyte", {
  configurable: true,
  value: {
    sessions: { snapshot: () => new Promise(() => {}) },
    watch: () => () => {},
    workspace: { vcs: { diff: async () => [] } },
    host: {
      state: () => new Promise(() => {}),
      catalog: () => new Promise(() => {}),
      setThemePreference: () => {},
      files: { list: async () => [] },
      vcs: { snapshot: vcsSnapshot, diff: scopedDiff, log, refs, revert },
    },
    plugins: { catalog: () => new Promise(() => {}) },
  },
});
