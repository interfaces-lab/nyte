import type { VcsChange, VcsDiff, VcsLog, VcsRefs, VcsSnapshot } from "@nyte-ai/protocol";
import type { NyteBridge } from "../bridge.ts";

export const FILE_COUNT = 180;

export const COMMIT_OID = "c0ffee0badc0ffee0badc0ffee0badc0ffee0bad";

export const pathAt = (index: number): string => `src/file-${String(index).padStart(3, "0")}.ts`;

export const PATHS = Array.from({ length: FILE_COUNT }, (_, index) => pathAt(index));

/** Its patch is empty under every comparison, so the host leaves it out of each answer. */
export const ABSENT = pathAt(2);

/** Its patch outgrows the host's limit. */
export const TOO_LARGE = pathAt(177);

const LINES = 40;

/** Forty replaced lines, each naming the file and the side it came from. */
export function patchFor(path: string, side: string): string {
  const old = Array.from({ length: LINES }, (_, index) => `-${side}-old ${path} ${String(index)}`);
  const next = Array.from({ length: LINES }, (_, index) => `+${side}-new ${path} ${String(index)}`);

  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${String(LINES)} +1,${String(LINES)} @@`,
    ...old,
    ...next,
    "",
  ].join("\n");
}

interface DiffCall {
  readonly scope: string;
  readonly paths: readonly string[];
}

/** What the panel asked of the scripted host, and switches that hold answers open. */
export const demandScript = {
  events: new Array<string>(),
  diffCalls: new Array<DiffCall>(),
  active: 0,
  peak: 0,
  revision: 1,
  /** How long an unheld read takes to answer. */
  latencyMs: 15,
  holdDiff: false,
  heldDiffs: new Array<() => void>(),
  holdChanges: false,
  heldChanges: new Array<() => void>(),
};

export function releaseHeld(): void {
  const held = [...demandScript.heldDiffs, ...demandScript.heldChanges];
  demandScript.heldDiffs.length = 0;
  demandScript.heldChanges.length = 0;

  for (const release of held) release();
}

const sideOf = (scope: { readonly kind: string }): string =>
  scope.kind === "commit" ? "commit" : "worktree";

const snapshot = async (): Promise<VcsSnapshot> => {
  demandScript.events.push("snapshot");

  return {
    kind: "repository",
    root: "demand-repo",
    revision: `revision-${String(demandScript.revision)}`,
    head: { kind: "attached", oid: COMMIT_OID, branch: "main", upstream: null, base: null },
    staged: [],
    unstaged: PATHS.map((path) => ({ path, kind: "modified" })),
  };
};

const changes: NyteBridge["workspace"]["vcs"]["changes"] = async (input) => {
  demandScript.events.push(`changes:${input.scope.kind}`);

  if (demandScript.holdChanges) {
    await new Promise<void>((resolve) => demandScript.heldChanges.push(resolve));
  }

  const listed = input.scope.kind === "commit" ? PATHS.slice(0, 4) : PATHS;

  return listed.map((path): VcsChange => ({
    path,
    kind: "modified",
    stat:
      path === TOO_LARGE
        ? { kind: "text", added: 90_000, removed: 0 }
        : { kind: "text", added: LINES, removed: LINES },
  }));
};

const diff: NyteBridge["workspace"]["vcs"]["diff"] = async (input) => {
  demandScript.diffCalls.push({ scope: input.scope.kind, paths: [...input.paths] });
  demandScript.events.push(`diff:${input.scope.kind}:${String(input.paths.length)}`);
  demandScript.active += 1;
  demandScript.peak = Math.max(demandScript.peak, demandScript.active);

  try {
    if (demandScript.holdDiff) {
      await new Promise<void>((resolve) => demandScript.heldDiffs.push(resolve));
    } else {
      await new Promise<void>((resolve) => window.setTimeout(resolve, demandScript.latencyMs));
    }
  } finally {
    demandScript.active -= 1;
  }

  return input.paths.flatMap((path): VcsDiff[] => {
    if (path === ABSENT) return [];

    if (path === TOO_LARGE)
      return [{ path, status: "modified", kind: "too_large", limit: 2_000_000 }];

    return [
      {
        path,
        status: "modified",
        kind: "text",
        added: LINES,
        removed: LINES,
        patch: patchFor(path, sideOf(input.scope)),
      },
    ];
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
        snapshot,
        changes,
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
