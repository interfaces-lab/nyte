// Standalone browser-test preload for the changes panel's data layer.
// Import before any renderer module reads window.nyte.
import { sessionId } from "@nyte-ai/protocol";
import type { SessionSnapshot, Turn, VcsStatus } from "@nyte-ai/core";
import type { DesktopVcsSnapshot, NyteBridge } from "../../../shared/ipc.ts";

export const changesSession = sessionId("changes-scope-session");

type ConversationTurn = Extract<Turn, { kind: "turn" }>;

/** Same fabricator shape as changes-panel.test.ts: one tool result per patch. */
function changedTurn(id: string, patches: readonly string[]): ConversationTurn {
  return {
    kind: "turn",
    id,
    outcome: "completed",
    startedAt: 1,
    durationMs: 1,
    parts: patches.map((patch, index) => ({
      kind: "tool",
      callId: `${id}-call-${String(index)}`,
      toolName: "edit",
      result: {
        commit: `${id}-result-${String(index)}`,
        output: "",
        isError: false,
        details: { patch },
      },
    })),
  };
}

const patchOf = (path: string, line: string): string =>
  [`--- a/${path}`, `+++ b/${path}`, "@@ -1 +1,2 @@", " old", `+${line}`, ""].join("\n");

export const FIRST_TURN = "turn-first";
export const SECOND_TURN = "turn-second";
export const THIRD_TURN = "turn-third";

export const firstTurn = changedTurn(FIRST_TURN, [patchOf("src/first.ts", "first")]);
export const secondTurn = changedTurn(SECOND_TURN, [patchOf("src/second.ts", "second")]);
export const thirdTurn = changedTurn(THIRD_TURN, [patchOf("src/third.ts", "third")]);

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

const workingTree: DesktopVcsSnapshot = {
  kind: "repository",
  repositoryId: "changes-scope-repo",
  revision: "revision-1",
  status: { branch: "main", files: [{ path: "src/working.ts", kind: "modified" }] },
};

/** Everything the panel's reads answer with, plus the counters a test reads back. */
interface ChangesScopeScript {
  snapshotReads: number;
  watches: number;
  unwatches: number;
  vcsReads: number;
  diffReads: number;
  transcript: readonly Turn[];
  /** Hold the next read open until `releaseSnapshot` runs. */
  hangSnapshot: boolean;
  failSnapshot: boolean;
  vcsFiles: VcsStatus["files"];
  release: (() => void) | undefined;
}

export const changesScopeScript: ChangesScopeScript = {
  snapshotReads: 0,
  watches: 0,
  unwatches: 0,
  vcsReads: 0,
  diffReads: 0,
  transcript: [firstTurn, secondTurn, thirdTurn],
  hangSnapshot: false,
  failSnapshot: false,
  vcsFiles: workingTree.status.files,
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

const vcsSnapshot = async (): Promise<DesktopVcsSnapshot> => {
  changesScopeScript.vcsReads += 1;
  return { ...workingTree, status: { branch: "main", files: changesScopeScript.vcsFiles } };
};

const diff: NyteBridge["workspace"]["vcs"]["diff"] = async (input) => {
  changesScopeScript.diffReads += 1;
  return (input?.paths ?? []).map((path) => ({ path, patch: patchOf(path, "working") }));
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
    workspace: { vcs: { diff } },
    host: {
      state: () => new Promise(() => {}),
      catalog: () => new Promise(() => {}),
      setThemePreference: () => {},
      vcs: { snapshot: vcsSnapshot },
    },
    plugins: { catalog: () => new Promise(() => {}) },
  },
});
