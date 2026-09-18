import assert from "node:assert/strict";
import { afterAll, afterEach, describe, test, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parsePatchFacts } from "@nyte-ai/client";
import type { Turn, VcsDiff } from "@nyte-ai/protocol";
import type { DesktopVcsDiffInput, DesktopVcsSnapshot } from "../../../shared/ipc.ts";
import { turnChangeOptions, visibleTurnOptions } from "./change-scopes.ts";
import { ChangesPanel, revertConfirmation } from "./changes-panel.tsx";
import { changesViewOptions } from "./changes-view-options.ts";
import type { WorkbenchChangesScope } from "./controller.ts";
import { fileListLabel } from "./file-list-label.ts";

// The panel reaches Electron only through these reads; faking them leaves every
// scope, fold and render decision in the panel under test. Menu rows do their
// own reads, but a popup mounts only once opened, so every request recorded
// here is one the panel itself asked for.
const reads = vi.hoisted(() => ({
  vcs: { data: undefined, error: null } as {
    data: DesktopVcsSnapshot | undefined;
    error: Error | null;
  },
  diffs: [] as readonly VcsDiff[],
  requests: [] as { request: DesktopVcsDiffInput | undefined; enabled: boolean }[],
}));

vi.hoisted(() => {
  const query = { matches: false, addEventListener: () => {}, removeEventListener: () => {} };
  vi.stubGlobal("window", {
    nyte: { host: { setThemePreference: () => {} } },
    matchMedia: () => query,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  const styleHost = { insertBefore: () => {}, appendChild: () => {}, firstChild: null };
  vi.stubGlobal("document", {
    documentElement: { dataset: {}, style: { setProperty: () => {} } },
    getElementsByTagName: () => [styleHost],
    createElement: () => ({ setAttribute: () => {}, appendChild: () => {}, textContent: "" }),
    createTextNode: (text: string) => ({ text }),
    head: styleHost,
  });
});
afterAll(() => vi.unstubAllGlobals());

vi.mock("../queries.ts", () => ({
  useSessionSnapshot: () => ({ data: undefined, error: null }),
  useVcsSnapshot: () => reads.vcs,
  useVcsDiffs: () => ({ data: [], isLoading: false, isError: false }),
  useVcsScopedDiffs: (
    identity: { readonly request: DesktopVcsDiffInput } | undefined,
    enabled: boolean,
  ) => {
    reads.requests.push({ request: identity?.request, enabled });
    return { data: reads.diffs, isLoading: false, isError: false };
  },
  useVcsLog: () => ({ data: { commits: [], hasMore: false }, isPending: false }),
  useVcsRefs: () => ({ data: { local: [], remote: [] } }),
  refreshVcs: () => undefined,
}));

type ConversationTurn = Extract<Turn, { kind: "turn" }>;

function changedTurn(id: string, patches: readonly string[]): ConversationTurn {
  return {
    kind: "turn",
    id,
    outcome: "completed",
    startedAt: 0,
    durationMs: 0,
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

const addA = ["--- a/src/a.ts", "+++ b/src/a.ts", "@@ -1 +1,2 @@", " old", "+first", ""].join("\n");
const editA = ["--- a/src/a.ts", "+++ b/src/a.ts", "@@ -2 +2 @@", "-first", "+second", ""].join(
  "\n",
);
const addB = ["--- a/src/b.ts", "+++ b/src/b.ts", "@@ -0,0 +1 @@", "+new", ""].join("\n");

describe("turn change options", () => {
  test("lists every turn newest first and keeps all patches for a file", () => {
    const unchanged: ConversationTurn = {
      kind: "turn",
      id: "turn-2",
      outcome: "completed",
      startedAt: 0,
      durationMs: 0,
      parts: [],
    };
    const options = turnChangeOptions([
      changedTurn("turn-1", [addA, editA]),
      unchanged,
      changedTurn("turn-3", [addB]),
    ]);

    assert.deepEqual(
      options.map((option) => ({
        label: option.label,
        turnId: option.scope.turnId,
        stats: option.stats,
      })),
      [
        { label: "Latest", turnId: "turn-3", stats: { added: 1, removed: 0 } },
        { label: "Turn 2", turnId: "turn-2", stats: { added: 0, removed: 0 } },
        { label: "Turn 1", turnId: "turn-1", stats: { added: 2, removed: 1 } },
      ],
    );
    assert.equal(options[2]?.files[0]?.patch, `${addA}\n${editA}`);
  });

  test("hides empty turns unless they are selected or show-all is on", () => {
    const options = turnChangeOptions([
      changedTurn("turn-1", [addA]),
      {
        kind: "turn",
        id: "turn-2",
        outcome: "completed",
        startedAt: 0,
        durationMs: 0,
        parts: [],
      },
      changedTurn("turn-3", [addB]),
    ]);

    assert.deepEqual(
      visibleTurnOptions(options, false, undefined).map((option) => option.scope.turnId),
      ["turn-3", "turn-1"],
    );
    assert.deepEqual(
      visibleTurnOptions(options, false, "turn-2").map((option) => option.scope.turnId),
      ["turn-3", "turn-2", "turn-1"],
    );
    assert.equal(visibleTurnOptions(options, true, undefined).length, 3);
  });
});

describe("file list labels", () => {
  test("uses the basename until a peer shares it", () => {
    assert.equal(fileListLabel("src/a.ts", ["src/a.ts", "src/b.ts"]), "a.ts");
    assert.equal(
      fileListLabel("src/theme/styles.ts", ["src/theme/styles.ts", "src/conversation/styles.ts"]),
      "theme/styles.ts",
    );
    assert.equal(fileListLabel("a/styles.ts", ["a/styles.ts", "b/a/styles.ts"]), "a/styles.ts");
    assert.equal(fileListLabel("b/a/styles.ts", ["a/styles.ts", "b/a/styles.ts"]), "b/a/styles.ts");
  });
});

test("multi-file rows isolate their patches and retain the original tool output", () => {
  const deletion = "--- a/deleted.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-gone\n";
  const rename =
    "diff --git a/old.txt b/renamed.txt\nsimilarity index 100%\nrename from old.txt\nrename to renamed.txt\n--- a/old.txt\n+++ b/renamed.txt\n";
  const unchanged = "--- a/unchanged.txt\n+++ b/unchanged.txt\n";
  const raw = `${addA}${addB}${deletion}${rename}${unchanged}`;
  const turn = changedTurn("multi", [raw]);
  const option = turnChangeOptions([{ ...turn, parts: [...turn.parts, ...turn.parts] }])[0];
  assert.ok(option);
  assert.deepEqual(option.stats, { added: 2, removed: 1 });
  assert.deepEqual(
    option.files.map((row) => row.change.path),
    ["src/a.ts", "src/b.ts", "deleted.txt", "renamed.txt", "unchanged.txt"],
  );
  for (const row of option.files) {
    assert.deepEqual(row.rawPatches, [raw]);
    const facts = parsePatchFacts(row.patch);
    assert.ok(facts);
    assert.equal(facts.files.length, 1);
    assert.equal(facts.files[0]?.path, row.change.path);
    assert.equal(facts.added, row.change.added);
    assert.equal(facts.removed, row.change.removed);
    assert.equal(row.change.lastCommit, "multi-result-0");
  }
  assert.match(option.files[3]?.rawPatches[0] ?? "", /rename from old.txt\nrename to renamed.txt/);
  const renamed = parsePatchFacts(option.files[3]?.patch ?? "")?.files[0];
  assert.equal(renamed?.oldFileName, "a/old.txt");
  assert.equal(renamed?.newFileName, "b/renamed.txt");
  assert.deepEqual(
    option.files.slice(3).map((row) => [row.change.added, row.change.removed]),
    [
      [0, 0],
      [0, 0],
    ],
  );
});

test("invalid and failed patches contribute no rows while valid later results survive", () => {
  const turn = changedTurn("mixed", ["--- a/bad\n+++ b/bad\n@@ -1 +1 @@\n-old\n", addB]);
  const failed = changedTurn("failed", [addA]);
  const option = turnChangeOptions([
    {
      ...turn,
      parts: [
        ...failed.parts.map((part) =>
          part.kind === "tool" && part.result !== undefined
            ? { ...part, result: { ...part.result, isError: true } }
            : part,
        ),
        ...turn.parts,
      ],
    },
  ])[0];
  assert.deepEqual(
    option?.files.map((row) => row.change.path),
    ["src/b.ts"],
  );
  assert.deepEqual(option?.stats, { added: 1, removed: 0 });
});

const repositorySnapshot: DesktopVcsSnapshot = {
  kind: "repository",
  repositoryId: "repo",
  revision: "rev-1",
  status: { branch: "main", files: [{ path: "src/working.ts", kind: "modified" }] },
  head: { oid: "c0ffee0badc0ffee", branch: "main", upstream: "origin/main", ahead: 0, behind: 0 },
  staged: [{ path: "src/staged.ts", kind: "added" }],
  unstaged: [{ path: "src/working.ts", kind: "modified" }],
};

const commitPatch = [
  "--- a/src/committed.ts",
  "+++ b/src/committed.ts",
  "@@ -1,2 +1,3 @@",
  " keep",
  "-old",
  "+new",
  "+more",
  "",
].join("\n");

function renderScope(
  scope: WorkbenchChangesScope,
  diffs: readonly VcsDiff[] = [],
): {
  readonly markup: string;
  readonly reads: readonly { request: DesktopVcsDiffInput | undefined; enabled: boolean }[];
} {
  reads.vcs = { data: repositorySnapshot, error: null };
  reads.diffs = diffs;
  reads.requests = [];
  const markup = renderToStaticMarkup(
    createElement(ChangesPanel, {
      sessionId: undefined,
      scope,
      selectedPath: undefined,
      revealPathRevision: 0,
      scrollTop: 0,
      fileTreeVisible: true,
      onScopeChange: () => undefined,
      onToggleFileTree: () => undefined,
      onSelectPath: () => undefined,
      onRevealPath: () => undefined,
      onScrollTop: () => undefined,
    }),
  );
  return { markup, reads: reads.requests };
}

function renderedPaths(markup: string): readonly string[] {
  return [...markup.matchAll(/data-change-path="([^"]*)"/g)].map((match) => match[1] ?? "");
}

function shownScope(markup: string): string {
  return /aria-label="Showing ([^"]*)"/.exec(markup)?.[1] ?? "";
}

function banner(markup: string): string | null {
  const match = /role="(?:status|alert)"[^>]*>([^<]*)</.exec(markup);
  return match === null ? null : (match[1] ?? "");
}

describe("working-tree scopes", () => {
  afterEach(() => {
    changesViewOptions.reset("repo");
  });

  test("each scope reads its own diff and lists the files that scope reports", () => {
    const staged = renderScope({ kind: "staged" });
    assert.equal(shownScope(staged.markup), "Staged");
    assert.deepEqual(renderedPaths(staged.markup), ["src/staged.ts"]);
    assert.deepEqual(staged.reads, [
      {
        request: { scope: "staged", paths: ["src/staged.ts"], ignoreWhitespace: false },
        enabled: true,
      },
    ]);

    const unstaged = renderScope({ kind: "unstaged" });
    assert.equal(shownScope(unstaged.markup), "Unstaged");
    assert.deepEqual(renderedPaths(unstaged.markup), ["src/working.ts"]);
    assert.equal(unstaged.reads[0]?.request?.scope, "unstaged");

    const uncommitted = renderScope({ kind: "uncommitted" });
    assert.equal(shownScope(uncommitted.markup), "Uncommitted");
    assert.equal(uncommitted.reads[0]?.request?.scope, "worktree");
  });

  test("ignoring whitespace changes the read, not the scope", () => {
    changesViewOptions.setOptions("repo", { ignoreWhitespace: true });
    const { reads: requests } = renderScope({ kind: "uncommitted" });
    assert.deepEqual(requests[0]?.request, {
      scope: "worktree",
      paths: ["src/working.ts"],
      ignoreWhitespace: true,
    });
  });

  test("an empty scope stays selectable and explains itself instead of reading", () => {
    reads.vcs = { data: { ...repositorySnapshot, staged: [] }, error: null };
    reads.diffs = [];
    reads.requests = [];
    const markup = renderToStaticMarkup(
      createElement(ChangesPanel, {
        sessionId: undefined,
        scope: { kind: "staged" },
        selectedPath: undefined,
        revealPathRevision: 0,
        scrollTop: 0,
        fileTreeVisible: true,
        onScopeChange: () => undefined,
        onToggleFileTree: () => undefined,
        onSelectPath: () => undefined,
        onRevealPath: () => undefined,
        onScrollTop: () => undefined,
      }),
    );
    assert.equal(shownScope(markup), "Staged");
    assert.equal(banner(markup), "Nothing is staged");
    // Nothing to narrow the read to, so no diff is requested.
    assert.equal(reads.requests[0]?.enabled, false);
  });
});

describe("commit scope", () => {
  test("builds its rows and counts from the commit's own diff", () => {
    const { markup, reads: requests } = renderScope({ kind: "commit", oid: "c0ffee0badc0ffee" }, [
      { path: "src/committed.ts", patch: commitPatch },
    ]);
    assert.deepEqual(requests, [
      {
        request: {
          scope: "commit",
          commit: "c0ffee0badc0ffee",
          paths: undefined,
          ignoreWhitespace: false,
        },
        enabled: true,
      },
    ]);
    // No listed commit to name it, so the trigger falls back to the short oid.
    assert.equal(shownScope(markup), "c0ffee0");
    assert.deepEqual(renderedPaths(markup), ["src/committed.ts"]);
    assert.match(markup, /aria-label="2 added, 1 removed"/);
  });

  test("a commit that changed nothing lands on the empty state", () => {
    const { markup } = renderScope({ kind: "commit", oid: "c0ffee0badc0ffee" });
    assert.equal(banner(markup), "This commit changed no files");
  });
});

/** Every revert affordance the panel rendered: the rail row's and the stack header's. */
function revertAffordances(markup: string): readonly { path: string; disabled: boolean }[] {
  return [...markup.matchAll(/<button[^>]*aria-label="Revert ([^"]*)"[^>]*>/g)].map((match) => ({
    path: match[1] ?? "",
    disabled: / disabled=""/.test(match[0]),
  }));
}

describe("revert", () => {
  test("a working-tree scope offers revert on every file, in the rail and the stack", () => {
    const { markup } = renderScope({ kind: "uncommitted" });

    assert.deepEqual(revertAffordances(markup), [
      { path: "src/working.ts", disabled: false },
      { path: "src/working.ts", disabled: false },
    ]);
  });

  test("a commit scope has nothing to revert to, so its affordances stay disabled", () => {
    const { markup } = renderScope({ kind: "commit", oid: "c0ffee0badc0ffee" }, [
      { path: "src/committed.ts", patch: commitPatch },
    ]);

    assert.deepEqual(revertAffordances(markup), [
      { path: "src/committed.ts", disabled: true },
      { path: "src/committed.ts", disabled: true },
    ]);
  });

  test("the confirmation names the file and warns that a revert cannot be undone", () => {
    const copy = revertConfirmation({ path: "src/working.ts", untracked: false });

    assert.equal(copy.title, "Revert changes?");
    assert.equal(
      copy.description,
      "src/working.ts goes back to the last commit, and its changes are lost. This can’t be undone.",
    );
    assert.equal(copy.confirmLabel, "Revert");
  });

  test("an untracked file is described as moving to the trash instead", () => {
    const copy = revertConfirmation({ path: "scratch.txt", untracked: true });

    assert.equal(copy.title, "Move to Trash?");
    assert.equal(
      copy.description,
      "scratch.txt is untracked, so reverting it moves the file to the trash.",
    );
    assert.equal(copy.confirmLabel, "Move to Trash");
    assert.doesNotMatch(copy.description, /undone/);
  });
});
