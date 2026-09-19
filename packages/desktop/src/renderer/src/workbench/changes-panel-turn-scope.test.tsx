/**
 * Drives the changes panel's presentational layer directly: the session read
 * and the working-tree read are faked so a turn scope can be rendered against a
 * resolved transcript, a failed read, an empty transcript, and a turn id the
 * transcript never held.
 *
 * Diff bodies paint in a `<diffs-container>` custom element on the client, so
 * static markup shows which sections, files and stats a scope produced, not the
 * diff text itself. That part is identical in every case here.
 */
import { afterAll, describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parsePatchFacts } from "@nyte-ai/client";
import { sessionId } from "@nyte-ai/protocol";
import type { Turn } from "@nyte-ai/protocol";
import type { DesktopVcsSnapshot } from "../../../shared/ipc.ts";
import { ChangesPanel } from "./changes-panel.tsx";
import type { WorkbenchChangesScope } from "./controller.ts";

interface SessionRead {
  readonly data: { readonly transcript: readonly Turn[] } | undefined;
  readonly error: Error | null;
}

interface VcsRead {
  readonly data: DesktopVcsSnapshot | undefined;
  readonly error: Error | null;
}

const reads = vi.hoisted((): { session: SessionRead; vcs: VcsRead } => ({
  session: { data: undefined, error: null },
  vcs: { data: undefined, error: null },
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

// The panel reaches Electron only through these four reads; faking them leaves
// every scope, fold and render decision in the panel under test.
vi.mock("../queries.ts", () => ({
  useSessionSnapshot: () => reads.session,
  useVcsSnapshot: () => reads.vcs,
  useVcsDiffs: () => ({ data: [], isLoading: false, isError: false }),
  useVcsScopedDiffs: () => ({ data: [], isLoading: false, isError: false }),
  useVcsLog: () => ({ data: { commits: [], hasMore: false }, isLoading: false, isError: false }),
  useVcsRefs: () => ({ data: { local: [], remote: [] }, isLoading: false, isError: false }),
  useRunDiff: () => ({ data: undefined, isLoading: false, isError: false }),
  refreshVcs: () => undefined,
}));

function changedTurn(id: string, patches: readonly string[]): Turn {
  return {
    kind: "turn",
    id,
    startedAt: 0,
    durationMs: 0,
    parts: patches.map((patch, index) => {
      const facts = parsePatchFacts(patch);
      return {
        kind: "tool",
        callId: `${id}-call-${String(index)}`,
        class: {
          kind: "file_patch",
          op: "edit",
          path: facts?.files[0]?.path ?? "",
          added: facts?.added ?? 0,
          removed: facts?.removed ?? 0,
          patch,
        },
        result: { commit: `${id}-result-${String(index)}`, output: "", isError: false },
      };
    }),
  };
}

const patchAlpha = [
  "--- a/src/alpha.ts",
  "+++ b/src/alpha.ts",
  "@@ -1 +1,2 @@",
  " keep",
  "+alpha-line",
  "",
].join("\n");
const patchBeta = [
  "--- a/src/beta.ts",
  "+++ b/src/beta.ts",
  "@@ -1,2 +1,3 @@",
  " keep",
  "-old-beta",
  "+beta-one",
  "+beta-two",
  "",
].join("\n");

const turnAlpha = changedTurn("turn-alpha", [patchAlpha]);
const turnBeta = changedTurn("turn-beta", [patchBeta]);
const quietTurn = changedTurn("turn-quiet", []);
const transcript = [turnAlpha, turnBeta];
const repository: DesktopVcsSnapshot = {
  kind: "repository",
  repositoryId: "repo",
  revision: "rev-1",
  status: { branch: "main", files: [] },
  head: { oid: "abcdef1", branch: "main", upstream: "origin/main", ahead: 0, behind: 0 },
  staged: [],
  unstaged: [],
};
const readFailure = new Error("session read failed");

function render({
  session,
  vcs = { data: repository, error: null },
  scope,
}: {
  readonly session: SessionRead;
  readonly vcs?: VcsRead;
  readonly scope: WorkbenchChangesScope;
}): string {
  reads.session = session;
  reads.vcs = vcs;
  return renderToStaticMarkup(
    <ChangesPanel
      sessionId={sessionId("chat")}
      scope={scope}
      selectedPath={undefined}
      revealPathRevision={0}
      scrollTop={0}
      fileTreeVisible
      onScopeChange={() => undefined}
      onToggleFileTree={() => undefined}
      onSelectPath={() => undefined}
      onRevealPath={() => undefined}
      onScrollTop={() => undefined}
    />,
  );
}

function text(markup: string): string {
  return markup.replaceAll("&#x27;", "'").replaceAll("&amp;", "&").replaceAll("&quot;", '"');
}

/** What a reader sees: the scope button, the banner, and the rendered sections. */
function screen(html: string) {
  const banner = /role="(status|alert)"[^>]*>([^<]*)</.exec(html);
  return {
    showing: text(/aria-label="Showing ([^"]*)"/.exec(html)?.[1] ?? ""),
    banner: banner === null ? null : { role: banner[1], message: text(banner[2] ?? "") },
    sections: html
      .split('data-change-path="')
      .slice(1)
      .map((chunk) => {
        const path = chunk.slice(0, chunk.indexOf('"'));
        const stats = /aria-label="(\d+ added, \d+ removed)"/.exec(chunk);
        return `${path} (${stats?.[1] ?? "no stats"})`;
      }),
  };
}

describe("changes panel turn scope", () => {
  const resolved: SessionRead = { data: { transcript }, error: null };

  test("baseline: each turn scope renders only its own files and counts", () => {
    expect(
      screen(render({ session: resolved, scope: { kind: "turn", turnId: "turn-alpha" } })),
    ).toEqual({
      showing: "Turn 1",
      banner: null,
      sections: ["src/alpha.ts (1 added, 0 removed)"],
    });
    expect(
      screen(render({ session: resolved, scope: { kind: "turn", turnId: "turn-beta" } })),
    ).toEqual({
      showing: "Latest",
      banner: null,
      sections: ["src/beta.ts (2 added, 1 removed)"],
    });
  });

  // The `showing: "Uncommitted"` in this file's unresolved-turn cases is not a
  // requirement. The panel collapses a stored turn scope it cannot resolve, so the
  // button disagrees with the controller. That is tracked separately as the pending
  // turn state; these expectations are expected to flip when it lands. The banner
  // assertions are the contract.
  test("a failed session read on a turn scope names the transcript, not Git", () => {
    expect(
      screen(
        render({
          session: { data: undefined, error: readFailure },
          scope: { kind: "turn", turnId: "turn-beta" },
        }),
      ),
    ).toEqual({
      showing: "Uncommitted",
      banner: {
        role: "alert",
        message: "Couldn't read this conversation's changes.",
      },
      sections: [],
    });
  });

  test("an unresolved turn with no failed read cannot yet explain itself", () => {
    expect(
      screen(
        render({
          session: { data: { transcript: [] }, error: null },
          scope: { kind: "turn", turnId: "turn-beta" },
        }),
      ),
    ).toEqual({
      showing: "Uncommitted",
      banner: { role: "status", message: "Working tree is clean" },
      sections: [],
    });
  });

  test("a turn id the transcript does not hold falls back to every declared change", () => {
    expect(
      screen(render({ session: resolved, scope: { kind: "turn", turnId: "turn-missing" } })),
    ).toEqual({
      showing: "Uncommitted",
      banner: null,
      sections: ["src/alpha.ts (1 added, 0 removed)", "src/beta.ts (2 added, 1 removed)"],
    });
  });

  test("a stale session error never reaches a turn that still has rows", () => {
    expect(
      screen(
        render({
          session: { data: { transcript }, error: readFailure },
          scope: { kind: "turn", turnId: "turn-alpha" },
        }),
      ),
    ).toEqual({
      showing: "Turn 1",
      banner: null,
      sections: ["src/alpha.ts (1 added, 0 removed)"],
    });
  });

  test("a turn that changed nothing says so, even while a session read is failing", () => {
    const quiet: SessionRead = { data: { transcript: [...transcript, quietTurn] }, error: null };
    const scope: WorkbenchChangesScope = { kind: "turn", turnId: "turn-quiet" };
    expect(screen(render({ session: quiet, scope }))).toEqual({
      showing: "Latest",
      banner: { role: "status", message: "This turn made no file changes" },
      sections: [],
    });
    expect(screen(render({ session: { ...quiet, error: readFailure }, scope }))).toEqual({
      showing: "Latest",
      banner: { role: "status", message: "This turn made no file changes" },
      sections: [],
    });
  });

  test("a turn scope ignores a failed working-tree read", () => {
    expect(
      screen(
        render({
          session: resolved,
          vcs: { data: undefined, error: new Error("not a git repository") },
          scope: { kind: "turn", turnId: "turn-beta" },
        }),
      ),
    ).toEqual({
      showing: "Latest",
      banner: null,
      sections: ["src/beta.ts (2 added, 1 removed)"],
    });
  });

  test("an unresolved turn falls back to the working tree and reports why it is empty", () => {
    // The panel is showing uncommitted rows here, so a failed working-tree read is
    // the reason the list is empty. Calling the tree clean would state a fact the
    // panel does not have.
    expect(
      screen(
        render({
          session: { data: { transcript: [quietTurn] }, error: null },
          vcs: { data: undefined, error: new Error("not a git repository") },
          scope: { kind: "turn", turnId: "turn-missing" },
        }),
      ),
    ).toEqual({
      showing: "Uncommitted",
      banner: {
        role: "alert",
        message: "Couldn't read changes. Check that this folder is a Git repository.",
      },
      sections: [],
    });
  });

  test("the default scope still names Git when the working-tree read fails", () => {
    expect(
      screen(
        render({
          session: { data: { transcript: [quietTurn] }, error: null },
          vcs: { data: undefined, error: new Error("git executable not found") },
          scope: { kind: "uncommitted" },
        }),
      ),
    ).toEqual({
      showing: "Uncommitted",
      banner: {
        role: "alert",
        message: "Couldn't read changes. Check that this folder is a Git repository.",
      },
      sections: [],
    });
  });

  test("an unresolved turn with both reads failing names the transcript", () => {
    // The turn is what was asked for, so the read that would have produced it is
    // the one worth reporting. Only one failure can show, so the working-tree one
    // is dropped here rather than kept anywhere.
    expect(
      screen(
        render({
          session: { data: undefined, error: readFailure },
          vcs: { data: undefined, error: new Error("not a git repository") },
          scope: { kind: "turn", turnId: "turn-missing" },
        }),
      ),
    ).toEqual({
      showing: "Uncommitted",
      banner: { role: "alert", message: "Couldn't read this conversation's changes." },
      sections: [],
    });
  });
});
