import assert from "node:assert/strict";
import { test } from "vitest";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { testRenderer } from "../../test/renderer.ts";

const offset = Type.Union([Type.Number(), Type.Null()]);

const observed = Type.Object({
  kind: Type.Literal("observed"),
  paths: Type.Number(),
  observations: Type.Object({
    metadataFirst: Type.Object({
      treeReady: Type.Boolean(),
      sidebarCount: Type.String(),
      eventsBeforeFirstDiff: Type.Array(Type.String()),
      firstRead: Type.Array(Type.String()),
      headersRendered: Type.Number(),
      unreadStats: Type.Union([Type.String(), Type.Null()]),
      unreadViewed: Type.Union([Type.String(), Type.Null()]),
    }),
    collapsed: Type.Object({
      callsAfterRelease: Type.Number(),
      callsAfterScroll: Type.Number(),
      readStats: Type.Union([Type.String(), Type.Null()]),
      readViewed: Type.Union([Type.String(), Type.Null()]),
    }),
    markAll: Type.Object({
      calls: Type.Number(),
      largestCall: Type.Number(),
      distinct: Type.Number(),
      repeated: Type.Number(),
      absentRequests: Type.Number(),
      tooLargeRequests: Type.Number(),
      peak: Type.Number(),
      report: Type.Union([Type.String(), Type.Null()]),
    }),
    prepared: Type.Object({
      requested: Type.Number(),
      distinct: Type.Number(),
      calls: Type.Number(),
      largestCall: Type.Number(),
      peak: Type.Number(),
      scrollTopWhilePreparing: Type.Number(),
      extentBefore: Type.Number(),
      extentAfter: Type.Number(),
      jumpedTo: Type.Array(Type.String()),
      headerOnlyAfterJump: Type.Array(Type.String()),
      readsAfterJump: Type.Number(),
      restoredPath: Type.Union([Type.String(), Type.Null()]),
      restoredTopPath: Type.Union([Type.String(), Type.Null()]),
      restoredShift: Type.Number(),
      readsAfterRestore: Type.Number(),
    }),
    incomplete: Type.Object({
      heldRead: Type.Array(Type.String()),
      nextRead: Type.Array(Type.String()),
      revealedOffset: offset,
      aboveRead: Type.Number(),
      offsetAfterAbove: offset,
      fastScroll: Type.Object({
        frames: Type.Number(),
        pxPerFrame: Type.Number(),
        filesReadBefore: Type.Number(),
        filesReadAfter: Type.Number(),
        framesWithHeaderOnlyFiles: Type.Number(),
        mostHeaderOnlyFiles: Type.Number(),
        anchorDriftSamples: Type.Number(),
        anchorDriftMaxPx: Type.Number(),
        anchorCorrections: Type.Number(),
        distinctExtents: Type.Number(),
        frameIntervalMs: Type.Object({
          p50: Type.Number(),
          p95: Type.Number(),
          max: Type.Number(),
        }),
        longTasksMs: Type.Array(Type.Number()),
      }),
      distinct: Type.Number(),
      repeated: Type.Number(),
      largestCall: Type.Number(),
      peak: Type.Number(),
      headerOnlyAtRest: Type.Array(Type.String()),
    }),
    scopeSwitch: Type.Object({
      commitShown: Type.Boolean(),
      commitReads: Type.Number(),
      worktreeShown: Type.Boolean(),
      stackPaths: Type.Array(Type.String()),
      peak: Type.Number(),
    }),
  }),
});

test(
  "a 180-file stack reads every expanded file in the background, rendered headers first",
  { timeout: 180_000 },
  async () => {
    const output = await testRenderer(
      new URL("./changes-demand.browser-test.tsx", import.meta.url),
    );

    const parsed: unknown = JSON.parse(output);

    if (!Value.Check(observed, parsed)) throw new Error(`The demand fixture failed: ${output}`);
    process.stdout.write(`${JSON.stringify(parsed.observations, null, 2)}\n`);

    const { metadataFirst, collapsed, markAll, prepared, incomplete, scopeSwitch } =
      parsed.observations;

    assert.equal(metadataFirst.sidebarCount, "180 Files Changed");
    assert.ok(metadataFirst.treeReady);
    assert.deepEqual(metadataFirst.eventsBeforeFirstDiff.slice(0, 1), ["snapshot"]);
    assert.ok(metadataFirst.firstRead.length <= 8, `first read ${String(metadataFirst.firstRead)}`);
    assert.ok(metadataFirst.firstRead.includes("src/file-000.ts"));
    assert.equal(metadataFirst.unreadStats, null, "No counts before the manifest or patch");
    assert.equal(metadataFirst.unreadViewed, "unknown", "A mark on an unread patch is unknown");

    assert.equal(collapsed.callsAfterRelease, 1, "Collapsed files are not read in the background");
    assert.equal(collapsed.callsAfterScroll, 1, "Scrolling collapsed headers reads nothing");
    assert.equal(collapsed.readStats, "40 added, 40 removed");
    assert.equal(collapsed.readViewed, "viewed");

    assert.ok(markAll.largestCall <= 16, `mark-all call of ${String(markAll.largestCall)}`);
    assert.equal(markAll.distinct, 180);
    assert.equal(markAll.repeated, 0);
    assert.equal(markAll.absentRequests, 1);
    assert.equal(markAll.tooLargeRequests, 1);
    assert.equal(markAll.peak, 1);
    assert.equal(markAll.report, "1 file wasn’t marked viewed because its diff couldn’t be read.");

    assert.equal(prepared.distinct, 180, "Every expanded file is read without scrolling");
    assert.equal(prepared.requested, prepared.distinct, "No file is read twice");
    assert.ok(prepared.largestCall <= 8, `background read of ${String(prepared.largestCall)}`);
    assert.equal(prepared.peak, 1);
    assert.equal(prepared.scrollTopWhilePreparing, 0);
    assert.ok(prepared.extentAfter > prepared.extentBefore * 10, "Bodies fill the stack");
    assert.ok(prepared.jumpedTo.length > 0);
    assert.deepEqual(prepared.headerOnlyAfterJump, [], "A far jump lands on prepared bodies");
    assert.equal(prepared.readsAfterJump, 0);
    assert.ok(prepared.restoredPath !== null);
    assert.equal(
      prepared.restoredTopPath,
      prepared.restoredPath,
      "Showing again restores the file",
    );
    // CodeView subtracts its sticky header from a restored position, as it did before.
    assert.ok(
      Math.abs(prepared.restoredShift) <= 44,
      `restored shift ${String(prepared.restoredShift)}`,
    );
    assert.equal(prepared.readsAfterRestore, 0);

    assert.ok(incomplete.heldRead.length > 0 && incomplete.heldRead.length <= 8);
    assert.equal(incomplete.nextRead[0], "src/file-150.ts", "The revealed file is read next");
    assert.ok(incomplete.nextRead.length <= 8);
    assert.ok(incomplete.revealedOffset !== null && Math.abs(incomplete.revealedOffset) <= 2);
    assert.ok(incomplete.aboveRead > 0);
    assert.equal(incomplete.offsetAfterAbove, incomplete.revealedOffset, "Reveal stays anchored");
    assert.ok(incomplete.fastScroll.filesReadBefore < 180, "Scrolling starts mid-preparation");
    assert.ok(incomplete.fastScroll.anchorDriftMaxPx <= 1, "Content moves only with the scroll");
    assert.equal(incomplete.distinct, 180);
    assert.equal(incomplete.repeated, 0);
    assert.ok(incomplete.largestCall <= 8);
    assert.equal(incomplete.peak, 1);
    assert.deepEqual(incomplete.headerOnlyAtRest, []);

    assert.ok(scopeSwitch.commitShown);
    assert.equal(scopeSwitch.worktreeShown, false, "The late worktree read never showed");
    assert.deepEqual(scopeSwitch.stackPaths.slice(0, 1), ["src/file-000.ts"]);
    assert.equal(scopeSwitch.peak, 1);
  },
);
