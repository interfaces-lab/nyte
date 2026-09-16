// Standalone browser-test preload for the Changes tab's commit surface.
// Import before any renderer module reads window.nyte.
import type { VcsStatus } from "@nyte-ai/core";
import type {
  DesktopVcsCommitInput,
  DesktopVcsCommitResult,
  DesktopVcsCreateBranch,
  DesktopVcsCreateBranchInput,
  DesktopVcsLog,
  DesktopVcsPullRequestResult,
  DesktopVcsPush,
  DesktopVcsPushInput,
  DesktopVcsRefs,
  DesktopVcsSnapshot,
  NyteBridge,
} from "../../../shared/ipc.ts";
import { bridgeError } from "../../../shared/errors.ts";

export const CHANGED = "src/working.ts";

/** The scripted repository, the answers it gives, and what the bar asked of it. */
interface CommitScript {
  files: VcsStatus["files"];
  revision: number;
  upstream: string | undefined;
  commits: DesktopVcsCommitInput[];
  pushes: DesktopVcsPushInput[];
  branches: DesktopVcsCreateBranchInput[];
  pullRequests: { readonly title: string }[];
  /** Answers for the next call of each route; the last entry repeats. */
  commitResults: DesktopVcsCommitResult[];
  pushResults: DesktopVcsPush[];
  branchResults: DesktopVcsCreateBranch[];
  pullRequestResults: DesktopVcsPullRequestResult[];
  /** Refuse the next commit the way a trust gate does. */
  refuseCommit: boolean;
}

export const commitScript: CommitScript = {
  files: [{ path: CHANGED, kind: "modified" }],
  revision: 1,
  upstream: "origin/main",
  commits: [],
  pushes: [],
  branches: [],
  pullRequests: [],
  commitResults: [],
  pushResults: [],
  branchResults: [],
  pullRequestResults: [],
  refuseCommit: false,
};

function nextAnswer<T>(answers: T[], fallback: T): T {
  return answers.length > 1 ? (answers.shift() ?? fallback) : (answers[0] ?? fallback);
}

const vcsSnapshot = async (): Promise<DesktopVcsSnapshot> => ({
  kind: "repository",
  repositoryId: "changes-commit-repo",
  revision: `revision-${String(commitScript.revision)}`,
  status: { branch: "main", files: commitScript.files },
  head: {
    oid: "c0ffee0",
    branch: "main",
    upstream: commitScript.upstream,
    ahead: 1,
    behind: 0,
  },
  staged: [],
  unstaged: commitScript.files,
});

const scopedDiff: NyteBridge["host"]["vcs"]["diff"] = async (input) =>
  (input.paths ?? commitScript.files.map((file) => file.path)).map((path) => ({
    path,
    patch: [`--- a/${path}`, `+++ b/${path}`, "@@ -1 +1,2 @@", " old", "+new", ""].join("\n"),
  }));

const commit: NyteBridge["host"]["vcs"]["commit"] = async (input) => {
  if (commitScript.refuseCommit) {
    commitScript.refuseCommit = false;
    // The bridge rejects with plain error data, exactly as the preload does.
    return Promise.reject(
      bridgeError({
        code: "forbidden",
        message: "Workspace trust is required. Review the workspace trust prompt.",
      }),
    );
  }
  commitScript.commits.push(input);
  const result = nextAnswer<DesktopVcsCommitResult>(commitScript.commitResults, {
    kind: "committed",
    oid: "1234567890abcdef",
    shortOid: "1234567",
    summary: input.message,
  });
  if (result.kind === "committed") {
    commitScript.files = [];
    commitScript.revision += 1;
  }
  return result;
};

const push: NyteBridge["host"]["vcs"]["push"] = async (input) => {
  commitScript.pushes.push(input);
  return nextAnswer<DesktopVcsPush>(commitScript.pushResults, {
    kind: "pushed",
    remote: "origin",
    branch: "main",
  });
};

const createBranch: NyteBridge["host"]["vcs"]["createBranch"] = async (input) => {
  commitScript.branches.push(input);
  return nextAnswer<DesktopVcsCreateBranch>(commitScript.branchResults, { kind: "created" });
};

const createPullRequest: NyteBridge["host"]["vcs"]["createPullRequest"] = async (input) => {
  commitScript.pullRequests.push({ title: input.title });
  return nextAnswer<DesktopVcsPullRequestResult>(commitScript.pullRequestResults, {
    kind: "created",
    url: "https://github.com/nyte/nyte/pull/7",
  });
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
      openExternal: async () => undefined,
      files: { list: async () => [] },
      vcs: {
        snapshot: vcsSnapshot,
        diff: scopedDiff,
        log,
        refs,
        revert: async () => ({ reverted: [], skipped: [] }),
        stage: async () => ({ staged: [], skipped: [] }),
        commit,
        push,
        createBranch,
        createPullRequest,
      },
    },
    plugins: { catalog: () => new Promise(() => {}) },
  },
});
