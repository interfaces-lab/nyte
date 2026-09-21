/**
 * The Changes toolbar's keyboard bindings and working-tree commit rules.
 */
import { afterAll, describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { VcsSnapshot } from "@nyte-ai/protocol";
import { ChangesToolbar, changesShortcutAction } from "./changes-toolbar.tsx";
import type { ChangesShortcutAction } from "./changes-toolbar.tsx";
import { defaultChangesViewOptions } from "./changes-view-options.ts";
import type { WorkbenchChangesScope } from "./controller.ts";

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

// Only the menu rows read the repository, and they mount with their popup.
vi.mock("../queries.ts", () => ({
  useVcsScopedDiffs: () => ({ data: [], isPending: false }),
  useVcsLog: () => ({ data: { commits: [], hasMore: false }, isPending: false }),
  refreshVcs: () => {},
}));

type ShortcutInput = Parameters<typeof changesShortcutAction>[0];

function keyEvent(input: Partial<ShortcutInput>): ShortcutInput {
  return {
    key: "",
    code: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    defaultPrevented: false,
    isComposing: false,
    ...input,
  };
}

const repository: Extract<VcsSnapshot, { kind: "repository" }> = {
  kind: "repository",
  root: "repo",
  revision: "rev-1",
  head: {
    kind: "attached",
    oid: "c0ffee0badc0ffee",
    branch: "main",
    upstream: { name: "origin/main", ahead: 2, behind: 1 },
    base: null,
  },
  staged: [],
  unstaged: [{ path: "src/a.ts", kind: "modified" }],
};

function render({
  snapshot = repository,
  scope = { kind: "uncommitted" },
  scopeLabel = "Uncommitted",
  stats = { added: 0, removed: 0 },
  fileCount,
}: {
  readonly snapshot?: VcsSnapshot | undefined;
  readonly scope?: WorkbenchChangesScope;
  readonly scopeLabel?: string;
  readonly stats?: { readonly added: number; readonly removed: number };
  readonly fileCount?: number | undefined;
} = {}): string {
  return renderToStaticMarkup(
    <ChangesToolbar
      scope={scope}
      scopeLabel={scopeLabel}
      scopeStats={stats}
      scopeFileCount={fileCount}
      snapshot={snapshot}
      repository={
        snapshot?.kind === "repository"
          ? { root: snapshot.root, revision: snapshot.revision }
          : undefined
      }
      branch={undefined}
      turnOptions={[]}
      viewOptions={defaultChangesViewOptions}
      fileTreeVisible
      onScopeChange={() => undefined}
      onViewOptionsChange={() => undefined}
      onToggleFileTree={() => undefined}
      onRefresh={() => undefined}
      onFilterFiles={() => undefined}
      allFilesCollapsed={false}
      onToggleCollapseAll={() => undefined}
    />,
  );
}

function labels(markup: string): readonly string[] {
  return [...markup.matchAll(/aria-label="([^"]*)"/g)].map((match) => match[1] ?? "");
}

describe("changes toolbar keyboard bindings", () => {
  test("matches the Changes bindings on each platform and nothing else", () => {
    const matched = (
      input: Partial<ShortcutInput>,
      mac: boolean,
    ): ChangesShortcutAction | undefined => changesShortcutAction(keyEvent(input), mac);

    expect(matched({ key: "f", metaKey: true }, true)).toBe("filter-files");
    expect(matched({ key: "r", metaKey: true }, true)).toBe("refresh");
    expect(matched({ key: ";", code: "Semicolon", ctrlKey: true, shiftKey: true }, true)).toBe(
      "ignore-whitespace",
    );
    // Shift rewrites the key on some layouts, so the physical key is what counts.
    expect(matched({ key: ":", code: "Semicolon", ctrlKey: true, shiftKey: true }, false)).toBe(
      "ignore-whitespace",
    );
    expect(matched({ key: "f", ctrlKey: true }, false)).toBe("filter-files");

    // The primary chord is the platform's, not both.
    expect(matched({ key: "f", ctrlKey: true }, true)).toBeUndefined();
    expect(matched({ key: "f", metaKey: true }, false)).toBeUndefined();
    expect(matched({ key: "f", metaKey: true, shiftKey: true }, true)).toBeUndefined();
    expect(matched({ key: "f", metaKey: true, altKey: true }, true)).toBeUndefined();
    expect(matched({ key: "g", metaKey: true }, true)).toBeUndefined();
    expect(matched({ key: ";", code: "Semicolon", ctrlKey: true }, true)).toBeUndefined();
    // An event another surface already handled, or a composing IME, is not ours.
    expect(matched({ key: "f", metaKey: true, defaultPrevented: true }, true)).toBeUndefined();
    expect(matched({ key: "f", metaKey: true, isComposing: true }, true)).toBeUndefined();
  });
});

describe("changes toolbar header", () => {
  test("the commit surface belongs to the working tree and to a repository", () => {
    const turn = render({ scope: { kind: "turn", turnId: "turn-1" }, scopeLabel: "Latest" });
    expect(labels(turn)).not.toContain("Commit message");
    const commit = render({
      scope: { kind: "commit", oid: "c0ffee0badc0ffee" },
      scopeLabel: "Fix it",
    });
    expect(labels(commit)).not.toContain("Commit message");
    const outsideGit = render({
      snapshot: { kind: "none" },
    });
    expect(labels(outsideGit)).not.toContain("Commit message");
  });

  test("the trigger shows its own counts, and the file total until a diff is read", () => {
    expect(labels(render({ stats: { added: 3, removed: 1 }, fileCount: 2 }))).toContain(
      "3 added, 1 removed",
    );
    const unread = render({ stats: { added: 0, removed: 0 }, fileCount: 2 });
    expect(unread).toContain("2 files");
    expect(labels(unread)).not.toContain("0 added, 0 removed");
    // Nothing read and nothing counted: the trigger says only which scope it is.
    expect(/\d+ files?</.test(render({ stats: undefined }))).toBe(false);
  });
});
