// Standalone browser-test preload for the Changes tab's commit surface.
// Import before any renderer module reads window.nyte.
import type {
  VcsBranchOutcome,
  VcsCommitOutcome,
  VcsCommitTarget,
  VcsFile,
  VcsLog,
  VcsPushOutcome,
  VcsRefs,
  VcsSnapshot,
} from "@nyte-ai/protocol";
import type { GitHubPullRequestOutcome, NyteBridge } from "../../../shared/ipc.ts";
import { bridgeError } from "../../../shared/errors.ts";

export const CHANGED = "src/working.ts";

/** The scripted repository, the answers it gives, and what the bar asked of it. */
interface CommitScript {
  files: VcsFile[];
  revision: number;
  upstream: string | undefined;
  commits: { readonly message: string; readonly target: VcsCommitTarget }[];
  pushes: { readonly setUpstream: boolean }[];
  branches: { readonly name: string; readonly checkout: boolean }[];
  pullRequests: { readonly title: string }[];
  /** Answers for the next call of each route; the last entry repeats. */
  commitResults: VcsCommitOutcome[];
  pushResults: VcsPushOutcome[];
  branchResults: VcsBranchOutcome[];
  pullRequestResults: GitHubPullRequestOutcome[];
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

const vcsSnapshot = async (): Promise<VcsSnapshot> => ({
  kind: "repository",
  root: "changes-commit-repo",
  revision: `revision-${String(commitScript.revision)}`,
  head: {
    oid: "c0ffee0",
    branch: {
      kind: "named",
      name: "main",
      upstream:
        commitScript.upstream === undefined
          ? null
          : { name: commitScript.upstream, ahead: 1, behind: 0 },
    },
    base: null,
  },
  staged: [],
  unstaged: commitScript.files,
});

const diff: NyteBridge["workspace"]["vcs"]["diff"] = async (input) =>
  (input.paths ?? commitScript.files.map((file) => file.path)).map((path) => ({
    path,
    kind: "modified",
    added: 1,
    removed: 0,
    patch: [`--- a/${path}`, `+++ b/${path}`, "@@ -1 +1,2 @@", " old", "+new", ""].join("\n"),
  }));

const commit: NyteBridge["workspace"]["vcs"]["commit"] = async (input) => {
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
  commitScript.commits.push({ message: input.message, target: input.target });
  const result = nextAnswer<VcsCommitOutcome>(commitScript.commitResults, {
    kind: "committed",
    oid: "1234567890abcdef",
    summary: input.message,
  });
  if (result.kind === "committed") {
    commitScript.files = [];
    commitScript.revision += 1;
  }
  return result;
};

const push: NyteBridge["workspace"]["vcs"]["push"] = async (input) => {
  commitScript.pushes.push({ setUpstream: input.setUpstream });
  return nextAnswer<VcsPushOutcome>(commitScript.pushResults, {
    kind: "pushed",
    remote: "origin",
    branch: "main",
  });
};

const createBranch: NyteBridge["workspace"]["vcs"]["createBranch"] = async (input) => {
  commitScript.branches.push({ name: input.name, checkout: input.checkout });
  return nextAnswer<VcsBranchOutcome>(commitScript.branchResults, { kind: "created" });
};

const createPullRequest: NyteBridge["host"]["github"]["createPullRequest"] = async (input) => {
  commitScript.pullRequests.push({ title: input.title });
  return nextAnswer<GitHubPullRequestOutcome>(commitScript.pullRequestResults, {
    kind: "created",
    url: "https://github.com/nyte/nyte/pull/7",
  });
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
        snapshot: vcsSnapshot,
        diff,
        log,
        refs,
        discard: async () => ({ kind: "applied", paths: [], skipped: [] }),
        stage: async () => ({ kind: "applied", paths: [], skipped: [] }),
        commit,
        push,
        createBranch,
      },
    },
    host: {
      state: () => new Promise(() => {}),
      catalog: () => new Promise(() => {}),
      setThemePreference: () => {},
      openExternal: async () => undefined,
      files: { list: async () => [] },
      github: { createPullRequest },
    },
    plugins: { catalog: () => new Promise(() => {}) },
  },
});
