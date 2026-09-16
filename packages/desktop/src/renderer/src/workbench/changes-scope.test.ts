/**
 * What the changes panel's data layer does when the selected scope changes.
 *
 * The panel, the shipped query client and the workbench controller run in a
 * real renderer; only the preload bridge is scripted, so the transcript read
 * can be held open, cancelled and failed on demand. The fixture drives the
 * dropdown the way a reader does and reports the query state, the scope the
 * controller holds and the paths the panel received for each step.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import { testRenderer } from "../../../../test/renderer.ts";
import type { DesktopVcsSnapshot } from "../../../shared/ipc.ts";
import {
  branchReadout,
  changesScopeLabel,
  changesScopeValue,
  commitScopeOptions,
  diffRequestForScope,
  diffScopeStats,
  workingTreeScopeOptions,
} from "./change-scopes.ts";
import type { WorkbenchChangesScope } from "./controller.ts";

const text = Type.Union([Type.String(), Type.Null()]);
const observation = Type.Object({
  step: Type.String(),
  scopeKind: Type.String(),
  scopeTurnId: text,
  scopeLabel: text,
  alert: text,
  treeFiles: Type.Array(Type.String()),
  stackPaths: Type.Array(Type.String()),
  snapshotReads: Type.Number(),
  watches: Type.Number(),
  unwatches: Type.Number(),
  queryStatus: Type.String(),
  fetchStatus: Type.String(),
  queryError: text,
  cachedTurnIds: Type.Array(Type.String()),
  observers: Type.Number(),
});
const report = Type.Array(observation);

type Observation = Static<typeof observation>;

async function readObservations(): Promise<ReadonlyMap<string, Observation>> {
  const output = await testRenderer(new URL("./changes-scope.browser-test.tsx", import.meta.url));
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error(`The changes scope fixture did not report observations: ${output}`);
  }
  if (!Value.Check(report, parsed)) throw new Error(`The changes scope fixture failed: ${output}`);
  return new Map(parsed.map((entry) => [entry.step, entry]));
}

// One renderer run answers every case below.
let reported: Promise<ReadonlyMap<string, Observation>> | undefined;
const observations = (): Promise<ReadonlyMap<string, Observation>> =>
  (reported ??= readObservations());

function at(steps: ReadonlyMap<string, Observation>, step: string): Observation {
  const observation = steps.get(step);
  if (observation === undefined) throw new Error(`Missing observation: ${step}`);
  return observation;
}

test(
  "selecting turns leaves the session read untouched and shows each turn's own diff",
  {
    timeout: 120_000,
  },
  async () => {
    const steps = await observations();

    const mounted = at(steps, "mounted on uncommitted");
    assert.equal(mounted.snapshotReads, 1);
    assert.deepEqual(mounted.stackPaths, [
      "src/first.ts",
      "src/second.ts",
      "src/third.ts",
      "src/working.ts",
    ]);

    const newest = at(steps, "selected the newest turn");
    const older = at(steps, "selected an older turn");
    const settled = at(steps, "after four more scope changes");
    for (const observation of [newest, older, settled]) {
      // The scope lives only in the controller: no remount, no extra read, no error.
      assert.equal(observation.snapshotReads, 1, observation.step);
      assert.equal(observation.observers, 1, observation.step);
      assert.equal(observation.queryStatus, "success", observation.step);
      assert.equal(observation.fetchStatus, "idle", observation.step);
      assert.equal(observation.queryError, null, observation.step);
      assert.equal(observation.alert, null, observation.step);
      assert.deepEqual(
        observation.cachedTurnIds,
        ["turn-first", "turn-second", "turn-third"],
        observation.step,
      );
    }
    assert.equal(newest.scopeLabel, "Showing Latest");
    assert.deepEqual(newest.stackPaths, ["src/third.ts"]);
    assert.equal(older.scopeLabel, "Showing Turn 1");
    assert.deepEqual(older.stackPaths, ["src/first.ts"]);
    assert.equal(settled.scopeTurnId, "turn-first");
    assert.deepEqual(settled.stackPaths, ["src/first.ts"]);

    const inFlight = at(steps, "read in flight");
    const duringFlight = at(steps, "scope changed while the read was in flight");
    assert.equal(inFlight.fetchStatus, "fetching");
    // A scope change neither aborts the open read nor starts another one.
    assert.equal(duringFlight.fetchStatus, "fetching");
    assert.equal(duringFlight.snapshotReads, inFlight.snapshotReads);
    assert.equal(duringFlight.queryError, null);
    assert.deepEqual(duringFlight.stackPaths, ["src/third.ts"]);
  },
);

test(
  "a turn missing from the transcript falls back to Uncommitted with no error",
  {
    timeout: 120_000,
  },
  async () => {
    const steps = await observations();

    const dropped = at(steps, "selected turn dropped from the transcript");
    assert.equal(dropped.scopeKind, "turn");
    assert.equal(dropped.scopeTurnId, "turn-first");
    // The stored scope still names the turn; the panel silently shows uncommitted work.
    assert.equal(dropped.scopeLabel, "Showing Uncommitted");
    assert.equal(dropped.alert, null);
    assert.equal(dropped.queryStatus, "success");
    assert.equal(dropped.queryError, null);
    assert.deepEqual(dropped.stackPaths, ["src/second.ts", "src/working.ts"]);

    // With the scope still stored, a later transcript holding the turn snaps back to it.
    const regained = at(steps, "transcript regained the dropped turn");
    assert.equal(regained.scopeTurnId, "turn-first");
    assert.equal(regained.scopeLabel, "Showing Turn 1");
    assert.deepEqual(regained.stackPaths, ["src/first.ts"]);

    const picked = at(steps, "picked Uncommitted while a dropped turn was still stored");
    assert.equal(picked.scopeKind, "uncommitted");
    const afterPick = at(steps, "transcript regained the turn after picking Uncommitted");
    assert.equal(afterPick.scopeKind, "uncommitted");
    assert.equal(afterPick.scopeLabel, "Showing Uncommitted");

    const reselected = at(steps, "reselected a present turn");
    assert.equal(reselected.scopeLabel, "Showing Turn 2");
    assert.deepEqual(reselected.stackPaths, ["src/second.ts"]);
    assert.equal(reselected.snapshotReads, 1);
  },
);

test(
  "only a cancellation that keeps its error, or a failed read, reaches the panel",
  {
    timeout: 120_000,
  },
  async () => {
    const steps = await observations();

    // How unmount cancels: the state reverts and no error is recorded.
    const reverted = at(steps, "in-flight read cancelled, reverting");
    assert.equal(reverted.queryStatus, "success");
    assert.equal(reverted.queryError, null);
    assert.equal(at(steps, "after the cancelled read resolved").queryError, null);

    // Without the revert, the cancellation itself becomes the panel's turnsError.
    const cancelled = at(steps, "in-flight read cancelled without revert");
    assert.equal(cancelled.queryStatus, "error");
    assert.equal(cancelled.queryError, "CancelledError");
    // Cached turns keep the selected turn's diff on screen, so the error stays invisible.
    assert.equal(cancelled.alert, null);
    assert.deepEqual(cancelled.stackPaths, ["src/third.ts"]);

    const unmounted = at(steps, "unmounted while the read was in flight");
    assert.equal(unmounted.observers, 0);
    const remounted = at(steps, "remounted after the aborted read");
    assert.equal(remounted.queryStatus, "success");
    assert.equal(remounted.queryError, null);
    assert.equal(remounted.scopeLabel, "Showing Latest");
    assert.deepEqual(remounted.stackPaths, ["src/third.ts"]);

    const failedWithCache = at(steps, "read failed with cached turns");
    assert.equal(failedWithCache.queryError, "Scripted snapshot failure");
    assert.equal(failedWithCache.alert, null);
    assert.deepEqual(failedWithCache.stackPaths, ["src/third.ts"]);

    const failedDirty = at(steps, "read failed with no cached turns, dirty working tree");
    assert.deepEqual(failedDirty.cachedTurnIds, []);
    assert.equal(failedDirty.scopeTurnId, "turn-third");
    assert.equal(failedDirty.scopeLabel, "Showing Uncommitted");
    assert.equal(failedDirty.alert, null);
    assert.deepEqual(failedDirty.stackPaths, ["src/working.ts"]);

    // The reported symptom: an error and no turn diff, from a failed read with
    // nothing cached, while the selected scope is still a turn. The banner now
    // names the read that actually failed instead of blaming the Git repository.
    const failedClean = at(steps, "read failed with no cached turns, clean working tree");
    assert.equal(failedClean.scopeTurnId, "turn-third");
    assert.equal(failedClean.scopeLabel, "Showing Uncommitted");
    assert.equal(failedClean.alert, "Couldn't read this conversation's changes.");
    assert.deepEqual(failedClean.stackPaths, []);

    const recovered = at(steps, "recovered");
    assert.equal(recovered.queryError, null);
    assert.equal(recovered.scopeLabel, "Showing Latest");
    assert.deepEqual(recovered.stackPaths, ["src/third.ts"]);
  },
);

const patch = (path: string): string =>
  [`--- a/${path}`, `+++ b/${path}`, "@@ -1,2 +1,3 @@", " keep", "-old", "+new", "+more", ""].join(
    "\n",
  );

const repository: DesktopVcsSnapshot = {
  kind: "repository",
  repositoryId: "repo",
  revision: "rev-1",
  status: { branch: "main", files: [{ path: "src/a.ts", kind: "modified" }] },
  head: { oid: "c0ffee0badc0ffee", branch: "main", upstream: "origin/main", ahead: 2, behind: 1 },
  staged: [{ path: "src/a.ts", kind: "modified" }],
  unstaged: [],
};

test("working-tree options carry the index split only when the snapshot holds it", () => {
  assert.deepEqual(
    workingTreeScopeOptions(repository, {
      uncommitted: [{ path: "src/a.ts", patch: patch("src/a.ts") }],
      staged: [],
    }),
    [
      {
        scope: { kind: "uncommitted" },
        label: "Uncommitted",
        detail: undefined,
        stats: { added: 2, removed: 1 },
        fileCount: 1,
      },
      {
        scope: { kind: "staged" },
        label: "Staged",
        detail: undefined,
        stats: { added: 0, removed: 0 },
        fileCount: 1,
      },
      {
        scope: { kind: "unstaged" },
        label: "Unstaged",
        // No diff was read for this scope, so it reports no counts rather than zeroes.
        detail: undefined,
        stats: undefined,
        fileCount: 0,
      },
    ],
  );

  const statusOnly: DesktopVcsSnapshot = {
    kind: "repository",
    repositoryId: "repo",
    revision: "rev-1",
    status: { files: [] },
  };
  assert.deepEqual(
    workingTreeScopeOptions(statusOnly).map((option) => option.scope.kind),
    ["uncommitted"],
  );
  assert.deepEqual(
    workingTreeScopeOptions(undefined).map((option) => option.fileCount),
    [undefined],
  );
});

test("a commit option names the commit and takes counts only once its diff is read", () => {
  const commits = [
    {
      oid: "c0ffee0badc0ffee",
      shortOid: "c0ffee0",
      subject: "Fix the thing",
      author: "Ada",
      committedAt: 1,
    },
    { oid: "deadbeef", shortOid: "deadbee", subject: "Start", author: "Ada", committedAt: 0 },
  ];
  assert.deepEqual(commitScopeOptions(commits, new Map([["deadbeef", { added: 3, removed: 0 }]])), [
    {
      scope: { kind: "commit", oid: "c0ffee0badc0ffee" },
      label: "Fix the thing",
      detail: "c0ffee0 · Ada",
      stats: undefined,
      fileCount: undefined,
    },
    {
      scope: { kind: "commit", oid: "deadbeef" },
      label: "Start",
      detail: "deadbee · Ada",
      stats: { added: 3, removed: 0 },
      fileCount: undefined,
    },
  ]);
});

test("every scope maps to the read that answers it", () => {
  assert.deepEqual(diffRequestForScope({ kind: "uncommitted" }), {
    scope: "worktree",
    paths: undefined,
    ignoreWhitespace: undefined,
  });
  assert.deepEqual(diffRequestForScope({ kind: "staged" }, { ignoreWhitespace: true }), {
    scope: "staged",
    paths: undefined,
    ignoreWhitespace: true,
  });
  assert.deepEqual(diffRequestForScope({ kind: "unstaged" }, { paths: ["src/a.ts"] }), {
    scope: "unstaged",
    paths: ["src/a.ts"],
    ignoreWhitespace: undefined,
  });
  assert.deepEqual(diffRequestForScope({ kind: "commit", oid: "c0ffee" }), {
    scope: "commit",
    commit: "c0ffee",
    paths: undefined,
    ignoreWhitespace: undefined,
  });
  // A turn's changes are folded from the transcript, so no VCS read serves it.
  assert.equal(diffRequestForScope({ kind: "turn", turnId: "turn-1" }), undefined);

  assert.deepEqual(diffScopeStats([{ path: "src/a.ts", patch: "not a patch" }]), {
    added: 0,
    removed: 0,
  });
});

test("scope values and labels stay distinct across kinds", () => {
  const scopes: readonly WorkbenchChangesScope[] = [
    { kind: "uncommitted" },
    { kind: "staged" },
    { kind: "unstaged" },
    { kind: "turn", turnId: "turn-1" },
    { kind: "commit", oid: "c0ffee0badc0ffee" },
  ];
  assert.deepEqual(scopes.map(changesScopeValue), [
    "uncommitted",
    "staged",
    "unstaged",
    "turn:turn-1",
    "commit:c0ffee0badc0ffee",
  ]);

  const options = workingTreeScopeOptions(repository);
  assert.equal(changesScopeLabel({ kind: "staged" }, options), "Staged");
  // A scope the menu does not list still names itself.
  assert.equal(changesScopeLabel({ kind: "commit", oid: "c0ffee0badc0ffee" }, []), "c0ffee0");
  assert.equal(changesScopeLabel({ kind: "turn", turnId: "turn-1" }, []), "Turn");
});

test("the branch readout reports tracking, detachment and an unborn head", () => {
  assert.deepEqual(branchReadout(repository), {
    label: "main",
    detached: false,
    unborn: false,
    upstream: "origin/main",
    ahead: 2,
    behind: 1,
  });
  assert.deepEqual(
    branchReadout({
      ...repository,
      status: { files: [] },
      head: { oid: "c0ffee0badc0ffee", ahead: 0, behind: 0 },
    }),
    {
      label: "c0ffee0",
      detached: true,
      unborn: false,
      upstream: undefined,
      ahead: 0,
      behind: 0,
    },
  );
  assert.deepEqual(
    branchReadout({ ...repository, head: { oid: null, branch: "main", ahead: 0, behind: 0 } })
      ?.unborn,
    true,
  );
  // A snapshot built from the status alone still names the branch.
  assert.deepEqual(branchReadout({ ...repository, head: undefined })?.label, "main");
  assert.equal(branchReadout(undefined), undefined);
  assert.equal(
    branchReadout({
      kind: "not_repository",
      repositoryId: "none",
      revision: "not-repository",
      status: { files: [] },
    }),
    undefined,
  );
});
