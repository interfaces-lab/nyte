import { add, CONTAINER, compose, constant, fromPoints, max, min, scale } from "./piecewise.ts";
import type { Piecewise } from "./piecewise.ts";

const EPSILON = 1e-9;

/** How a split's child takes space along the split. Adapted from `@pierre/layouts`. */
export interface ChildSpec {
  /** A fixed length; undefined for a child that shares by `weight`. */
  readonly px: number | undefined;
  readonly weight: number;
  readonly min: number;
}

/**
 * Each child's length as a function of the split's space, without its separators:
 *
 * 1. A child in pixels keeps its length. The others share the rest by weight, each at least its
 *    minimum.
 * 2. As the space shrinks, the shared children stop at their minimums first, then the children in
 *    pixels shrink in proportion to their lengths.
 * 3. Below the sum of the minimums, each child gets a part in proportion to its minimum.
 */
export function divide(specs: readonly ChildSpec[]): readonly Piecewise[] {
  const entries = specs.map((spec, index) => ({ spec, index }));
  const fixed = entries.filter((entry) => entry.spec.px !== undefined);
  const shared = entries.filter((entry) => entry.spec.px === undefined);

  if (fixed.length === 0 || shared.length === 0)
    return waterFill(
      specs.map((spec) => (spec.px === undefined ? spec.weight : fixedSize(spec))),
      specs.map((spec) => spec.min),
    );

  const fixedLength = sum(fixed.map((entry) => fixedSize(entry.spec)));
  const fixedMin = sum(fixed.map((entry) => entry.spec.min));
  const sharedMin = sum(shared.map((entry) => entry.spec.min));
  const allMin = fixedMin + sharedMin;

  const fixedSpace = min(
    constant(fixedLength),
    max(scale(CONTAINER, allMin > 0 ? fixedMin / allMin : 0), add(CONTAINER, constant(-sharedMin))),
  );

  const sharedSpace = add(CONTAINER, scale(fixedSpace, -1));

  const fixedShares = waterFill(
    fixed.map((entry) => fixedSize(entry.spec)),
    fixed.map((entry) => entry.spec.min),
  );

  const sharedShares = waterFill(
    shared.map((entry) => entry.spec.weight),
    shared.map((entry) => entry.spec.min),
  );

  const lengths = new Map([
    ...fixed.map(
      (entry, order) =>
        [entry.index, compose(fixedShares[order] ?? constant(0), fixedSpace)] as const,
    ),
    ...shared.map(
      (entry, order) =>
        [entry.index, compose(sharedShares[order] ?? constant(0), sharedSpace)] as const,
    ),
  ]);

  return specs.map((_, index) => lengths.get(index) ?? constant(0));
}

function fixedSize(spec: ChildSpec): number {
  return Math.max(spec.min, spec.px ?? 0);
}

function waterFill(weights: readonly number[], mins: readonly number[]): readonly Piecewise[] {
  const total = sum(weights);
  const shares = weights.map((weight) => (total > 0 ? weight / total : 1 / weights.length));
  const minimum = sum(mins);

  const lengthsAt = (lambda: number): readonly number[] =>
    shares.map((share, index) => Math.max(mins[index] ?? 0, share * lambda));

  const lambdas = mins
    .flatMap((value, index) => {
      const lambda = value / (shares[index] ?? 0);

      return Number.isFinite(lambda) ? [lambda] : [];
    })
    .toSorted((a, b) => a - b);

  const points = [
    { at: 0, lengths: shares.map(() => 0) },
    ...(minimum > 0 ? [{ at: minimum, lengths: mins }] : []),
    ...lambdas.map((lambda) => {
      const lengths = lengthsAt(lambda);

      return { at: sum(lengths), lengths };
    }),
  ].filter((point, index, all) => index === 0 || point.at > (all[index - 1]?.at ?? 0) + EPSILON);

  return shares.map((share, index) =>
    fromPoints(
      points.map((point) => point.at),
      points.map((point) => point.lengths[index] ?? 0),
      share,
    ),
  );
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
