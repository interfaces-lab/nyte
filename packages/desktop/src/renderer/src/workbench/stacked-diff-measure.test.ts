/**
 * Measured-first stacked geometry: heights recorded by a section that actually
 * mounted place the sections below it, while an unmounted section keeps the
 * estimate. Sections are stood in for by plain objects driven through a fake
 * ResizeObserver, so the rules hold without a DOM.
 */
import assert from "node:assert/strict";
import { describe, test } from "vitest";
import {
  STACKED_HEADER_HEIGHT,
  createStackedMeasurements,
  createStackedMeasurer,
  stackedOffsets,
  stackedScrollAfterResize,
  stackedSectionDigest,
  stackedSectionHeight,
  type ChangeStackSection,
  type StackedResizeEntry,
  type StackedResizeObserver,
  type StackedSectionIdentity,
} from "./stacked-diff.ts";

interface FakeSection {
  readonly path: string;
}

function fakeObservers() {
  const observed = new Set<FakeSection>();
  let emit: ((entries: readonly StackedResizeEntry<FakeSection>[]) => void) | undefined;
  const createObserver = (
    callback: (entries: readonly StackedResizeEntry<FakeSection>[]) => void,
  ): StackedResizeObserver<FakeSection> => {
    emit = callback;
    return {
      observe: (target) => observed.add(target),
      unobserve: (target) => observed.delete(target),
      disconnect: () => observed.clear(),
    };
  };
  const resize = (target: FakeSection, height: number): void => {
    if (!observed.has(target)) throw new Error(`${target.path} is not observed`);
    emit?.([{ target, borderBoxSize: [{ blockSize: height }], contentRect: { height } }]);
  };
  return { createObserver, resize, observed };
}

function identityOf(section: ChangeStackSection, collapsed = false): StackedSectionIdentity {
  return { path: section.path, digest: stackedSectionDigest(section), collapsed };
}

const patch = (body: string): string =>
  ["--- a/a.ts", "+++ b/a.ts", "@@ -1,1 +1,1 @@", body, ""].join("\n");

const estimateOf = (section: ChangeStackSection): number =>
  stackedSectionHeight({ section, contentWidth: 200, measureHeight: () => 20 });

describe("measured stacked geometry", () => {
  test("a mounted section's height places the sections below it", () => {
    const measurements = createStackedMeasurements();
    const observers = fakeObservers();
    let measured = 0;
    const measurer = createStackedMeasurer({
      measurements,
      createObserver: observers.createObserver,
      onMeasured: () => {
        measured += 1;
      },
    });

    const first: ChangeStackSection = { kind: "diff", path: "a.ts", patch: patch("-old") };
    const second: ChangeStackSection = { kind: "diff", path: "b.ts", patch: patch("+new") };
    const sections = [first, second];
    const node = { path: "a.ts" };
    measurer.attach(identityOf(first))(node);

    const place = () =>
      stackedOffsets(
        sections.map((section) => {
          const estimate = estimateOf(section);
          return {
            path: section.path,
            estimate,
            height: measurements.height(identityOf(section)) ?? estimate,
          };
        }),
      );

    const before = place();
    assert.equal(before[0]?.height, estimateOf(first));

    observers.resize(node, estimateOf(first) + 120);
    assert.equal(measured, 1);

    const after = place();
    assert.equal(after[0]?.height, estimateOf(first) + 120);
    assert.equal(after[1]?.top, before[1]!.top + 120);

    // A measurement must never become the section's own reserved height.
    assert.equal(after[0]?.estimate, estimateOf(first));

    // A section that never mounted still places from the estimator.
    assert.equal(after[1]?.height, estimateOf(second));

    // Re-reporting the same height changes no geometry, so nothing re-renders.
    observers.resize(node, estimateOf(first) + 120);
    assert.equal(measured, 1);
  });

  test("unmounting keeps the height; a new patch for the path drops it", () => {
    const measurements = createStackedMeasurements();
    const observers = fakeObservers();
    const measurer = createStackedMeasurer({
      measurements,
      createObserver: observers.createObserver,
      onMeasured: () => {},
    });

    const section: ChangeStackSection = { kind: "diff", path: "a.ts", patch: patch("-old") };
    const identity = identityOf(section);
    const node = { path: "a.ts" };
    const detach = measurer.attach(identity)(node);
    observers.resize(node, 400);
    detach?.();
    assert.equal(observers.observed.size, 0);
    assert.equal(measurements.height(identity), 400);

    const refetched: ChangeStackSection = { kind: "diff", path: "a.ts", patch: patch("-other") };
    measurements.record({ ...identityOf(refetched), height: 460 });
    assert.equal(measurements.height(identity), undefined);
    assert.equal(measurements.height(identityOf(refetched)), 460);
  });

  test("collapsing keeps the expanded height for when the section opens again", () => {
    const measurements = createStackedMeasurements();
    const section: ChangeStackSection = { kind: "diff", path: "a.ts", patch: patch("-old") };
    measurements.record({ ...identityOf(section), height: 400 });
    measurements.record({ ...identityOf(section, true), height: STACKED_HEADER_HEIGHT });
    assert.equal(measurements.height(identityOf(section)), 400);
    assert.equal(measurements.height(identityOf(section, true)), STACKED_HEADER_HEIGHT);
  });

  test("evicts least recently used measurements past the limit", () => {
    const measurements = createStackedMeasurements(2);
    const keep: ChangeStackSection = { kind: "raw", path: "keep.ts", text: "keep" };
    const old: ChangeStackSection = { kind: "raw", path: "old.ts", text: "old" };
    const fresh: ChangeStackSection = { kind: "raw", path: "fresh.ts", text: "fresh" };
    measurements.record({ ...identityOf(keep), height: 100 });
    measurements.record({ ...identityOf(old), height: 200 });
    // Reading `keep` makes `old` the least recently used entry.
    assert.equal(measurements.height(identityOf(keep)), 100);
    measurements.record({ ...identityOf(fresh), height: 300 });
    assert.equal(measurements.size, 2);
    assert.equal(measurements.height(identityOf(old)), undefined);
    assert.equal(measurements.height(identityOf(keep)), 100);
    assert.equal(measurements.height(identityOf(fresh)), 300);
  });

  test("a section above the viewport carries the scroll offset with it", () => {
    const previous = stackedOffsets([
      { path: "a.ts", height: 400 },
      { path: "b.ts", height: 400 },
      { path: "c.ts", height: 400 },
    ]);
    const grown = stackedOffsets([
      { path: "a.ts", height: 500 },
      { path: "b.ts", height: 400 },
      { path: "c.ts", height: 400 },
    ]);
    assert.equal(
      stackedScrollAfterResize({ previous, next: grown, scrollTop: 600 }),
      700,
      "the reader keeps their place below a section that grew above them",
    );

    // The section being read keeps its top edge: growing it moves nothing.
    const grownInView = stackedOffsets([
      { path: "a.ts", height: 400 },
      { path: "b.ts", height: 900 },
      { path: "c.ts", height: 400 },
    ]);
    assert.equal(stackedScrollAfterResize({ previous, next: grownInView, scrollTop: 600 }), 600);

    // A section below the viewport moves nothing either.
    const grownBelow = stackedOffsets([
      { path: "a.ts", height: 400 },
      { path: "b.ts", height: 400 },
      { path: "c.ts", height: 900 },
    ]);
    assert.equal(stackedScrollAfterResize({ previous, next: grownBelow, scrollTop: 600 }), 600);
  });

  test("a shrinking section above the viewport never scrolls past the top", () => {
    const previous = stackedOffsets([
      { path: "a.ts", height: 400 },
      { path: "b.ts", height: 400 },
    ]);
    const shrunk = stackedOffsets([
      { path: "a.ts", height: 10 },
      { path: "b.ts", height: 400 },
    ]);
    assert.equal(stackedScrollAfterResize({ previous, next: shrunk, scrollTop: 420 }), 30);
    assert.equal(stackedScrollAfterResize({ previous, next: shrunk, scrollTop: 401 }), 11);
  });
});
