// Standalone browser-test preload for the changes panel's data layer.
// Import before any renderer module reads window.nyte.
import { sessionId } from "@nyte-ai/protocol";
import type {
  SessionSnapshot,
  Turn,
  VcsFile,
  VcsLog,
  VcsRefs,
  VcsSnapshot,
} from "@nyte-ai/protocol";
import type { NyteBridge } from "../../../shared/ipc.ts";

export const changesSession = sessionId("changes-scope-session");

type ConversationTurn = Extract<Turn, { kind: "turn" }>;

const patchOf = (path: string, line: string): string =>
  [`--- a/${path}`, `+++ b/${path}`, "@@ -1 +1,2 @@", " old", `+${line}`, ""].join("\n");

/** Same fabricator shape as changes-panel.test.ts: one settled file_patch per path. */
function changedTurn(id: string, paths: readonly string[]): ConversationTurn {
  return {
    kind: "turn",
    id,
    startedAt: 1,
    durationMs: 1,
    parts: paths.map((path, index) => ({
      kind: "tool",
      callId: `${id}-call-${String(index)}`,
      class: {
        kind: "file_patch",
        op: "edit",
        path,
        added: 1,
        removed: 0,
        patch: patchOf(path, id),
      },
      result: { commit: `${id}-result-${String(index)}`, output: "", isError: false },
    })),
  };
}

export const FIRST_TURN = "turn-first";
export const SECOND_TURN = "turn-second";
export const THIRD_TURN = "turn-third";

export const firstTurn = changedTurn(FIRST_TURN, ["src/first.ts"]);
export const secondTurn = changedTurn(SECOND_TURN, ["src/second.ts"]);
export const thirdTurn = changedTurn(THIRD_TURN, ["src/third.ts"]);

const session: SessionSnapshot["session"] = {
  sessionId: changesSession,
  activation: { kind: "active" },
  createdAt: 1,
  lastActivityAt: 2,
  pinned: false,
  archived: false,
  heads: [],
  config: {},
};

export function snapshotWith(transcript: readonly Turn[]): SessionSnapshot {
  return {
    seq: 3,
    session,
    head: "main",
    tip: null,
    config: {},
    transcript,
    pending: [],
    context: { estimatedTokens: 0, usageTokens: 0, trailingTokens: 0, contextWindow: 1 },
  };
}

const workingTree: VcsSnapshot = {
  kind: "repository",
  root: "changes-scope-repo",
  revision: "revision-1",
  head: {
    oid: "c0ffee0",
    branch: {
      kind: "named",
      name: "main",
      upstream: { name: "origin/main", ahead: 1, behind: 0 },
    },
    base: null,
  },
  staged: [],
  unstaged: [{ path: "src/working.ts", kind: "modified" }],
};

const commits: VcsLog = {
  commits: [
    {
      oid: "c0ffee0",
      subject: "Add the working file",
      author: "Scripted Author",
      committedAt: 1,
    },
  ],
  hasMore: false,
};

/** Everything the panel's reads answer with, plus the counters a test reads back. */
interface ChangesScopeScript {
  snapshotReads: number;
  watches: number;
  unwatches: number;
  vcsReads: number;
  diffReads: number;
  logReads: number;
  refReads: number;
  transcript: readonly Turn[];
  /** Hold the next read open until `releaseSnapshot` runs. */
  hangSnapshot: boolean;
  failSnapshot: boolean;
  vcsFiles: VcsFile[];
  release: (() => void) | undefined;
}

export const changesScopeScript: ChangesScopeScript = {
  snapshotReads: 0,
  watches: 0,
  unwatches: 0,
  vcsReads: 0,
  diffReads: 0,
  logReads: 0,
  refReads: 0,
  transcript: [firstTurn, secondTurn, thirdTurn],
  hangSnapshot: false,
  failSnapshot: false,
  vcsFiles: [{ path: "src/working.ts", kind: "modified" }],
  release: undefined,
};

export function releaseSnapshot(): void {
  const release = changesScopeScript.release;
  changesScopeScript.release = undefined;
  release?.();
}

const snapshot: NyteBridge["sessions"]["snapshot"] = async () => {
  changesScopeScript.snapshotReads += 1;
  if (changesScopeScript.failSnapshot) throw new Error("Scripted snapshot failure");
  if (changesScopeScript.hangSnapshot) {
    await new Promise<void>((resolve) => {
      changesScopeScript.release = resolve;
    });
  }
  return snapshotWith(changesScopeScript.transcript);
};

const metadata: NyteBridge["sessions"]["metadata"] = async () => {
  const held = snapshotWith(changesScopeScript.transcript);
  return { session: held.session, head: held.head, config: held.config, context: held.context };
};

const vcsSnapshot = async (): Promise<VcsSnapshot> => {
  changesScopeScript.vcsReads += 1;
  return { ...workingTree, staged: [], unstaged: changesScopeScript.vcsFiles };
};

// The read answers from the same scripted status: staged is empty, and every
// other scope shows the working files.
const diff: NyteBridge["workspace"]["vcs"]["diff"] = async (input) => {
  changesScopeScript.diffReads += 1;
  if (input.scope.kind === "staged") return [];
  const paths = input.paths ?? changesScopeScript.vcsFiles.map((file) => file.path);
  return paths.map((path) => ({
    path,
    kind: "modified",
    added: 1,
    removed: 0,
    patch: patchOf(path, "working"),
  }));
};

const log = async (): Promise<VcsLog> => {
  changesScopeScript.logReads += 1;
  return commits;
};

const refs = async (): Promise<VcsRefs> => {
  changesScopeScript.refReads += 1;
  return { local: ["main"], remote: ["origin/main"] };
};

const watch: NyteBridge["watch"] = (input, _onEvent, _onEnd) => {
  changesScopeScript.watches += 1;
  void input;
  return () => {
    changesScopeScript.unwatches += 1;
  };
};

Object.defineProperty(window, "nyte", {
  configurable: true,
  value: {
    sessions: { snapshot, metadata },
    jobs: {
      list: async () => [],
      cancel: async () => ({ kind: "applied" }),
      background: async () => {},
    },
    watch,
    workspace: { vcs: { snapshot: vcsSnapshot, diff, log, refs } },
    host: {
      state: () => new Promise(() => {}),
      catalog: () => new Promise(() => {}),
      setThemePreference: () => {},
    },
    plugins: { catalog: () => new Promise(() => {}) },
  },
});
