/**
 * A continuous piecewise-linear function of one container size, from 0 up. Each pane edge is one,
 * so CSS can write it as a single `calc()` of the container size and a resize runs no script.
 * Adapted from `@pierre/layouts`.
 */
export interface Piecewise {
  /** Ascending knots; the first is 0. */
  readonly xs: readonly number[];
  readonly ys: readonly number[];
  /** The slope after the last knot. */
  readonly slope: number;
}

const EPSILON = 1e-9;

export const CONTAINER: Piecewise = { xs: [0], ys: [0], slope: 1 };

export function constant(value: number): Piecewise {
  return { xs: [0], ys: [value], slope: 0 };
}

export function evaluate(f: Piecewise, x: number): number {
  const index = Math.max(
    0,
    f.xs.findLastIndex((knot) => knot <= x),
  );

  const x0 = f.xs[index] ?? 0;
  const y0 = f.ys[index] ?? 0;
  const x1 = f.xs[index + 1];
  const y1 = f.ys[index + 1];

  if (x1 === undefined || y1 === undefined) return y0 + f.slope * (x - x0);

  return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
}

export function add(f: Piecewise, g: Piecewise): Piecewise {
  const xs = union(f.xs, g.xs);

  return fromPoints(
    xs,
    xs.map((x) => evaluate(f, x) + evaluate(g, x)),
    f.slope + g.slope,
  );
}

export function scale(f: Piecewise, factor: number): Piecewise {
  return { xs: f.xs, ys: f.ys.map((y) => y * factor), slope: f.slope * factor };
}

export function min(f: Piecewise, g: Piecewise): Piecewise {
  return envelope(f, g, Math.min);
}

export function max(f: Piecewise, g: Piecewise): Piecewise {
  return envelope(f, g, Math.max);
}

/** `outer(inner(x))`: the knots of `inner`, and where `inner` crosses a knot of `outer`. */
export function compose(outer: Piecewise, inner: Piecewise): Piecewise {
  const crossings = inner.xs.flatMap((x0, index) => {
    const y0 = inner.ys[index] ?? 0;
    const x1 = inner.xs[index + 1];
    const y1 = inner.ys[index + 1];

    if (x1 === undefined || y1 === undefined)
      return inner.slope === 0
        ? []
        : outer.xs.map((knot) => x0 + (knot - y0) / inner.slope).filter((x) => x > x0);

    return outer.xs
      .filter((knot) => (knot - y0) * (knot - y1) < 0)
      .map((knot) => x0 + ((knot - y0) * (x1 - x0)) / (y1 - y0));
  });

  const xs = union(inner.xs, crossings);

  const outerSlope =
    inner.slope > 0 ? outer.slope : inner.slope < 0 ? (slopes(outer)[0] ?? outer.slope) : 0;

  return fromPoints(
    xs,
    xs.map((x) => evaluate(outer, evaluate(inner, x))),
    outerSlope * inner.slope,
  );
}

/**
 * `f` as one CSS length of the container size `unit`: f(0) + s₀ × size + Σ (sᵢ − sᵢ₋₁) ×
 * max(0px, size − xᵢ), where sᵢ is the slope after knot xᵢ.
 */
export function piecewiseCss(f: Piecewise, unit: string): string {
  const rates = slopes(f);
  const first = rates[0] ?? 0;

  const hinges = f.xs.slice(1).flatMap((x, index) => {
    const change = (rates[index + 1] ?? 0) - (rates[index] ?? 0);

    return Math.abs(change) <= EPSILON
      ? []
      : [`${format(change)} * max(0px, ${unit} - ${format(x)}px)`];
  });

  const offset = f.ys[0] ?? 0;

  const terms = [
    ...(Math.abs(offset) > EPSILON ? [`${format(offset)}px`] : []),
    ...(Math.abs(first) > EPSILON ? [`${format(first)} * ${unit}`] : []),
    ...hinges,
  ];

  if (terms.length === 0) return "0px";

  return terms.length === 1 && Math.abs(offset) > EPSILON
    ? `${format(offset)}px`
    : `calc(${terms.join(" + ")})`;
}

function envelope(
  f: Piecewise,
  g: Piecewise,
  pick: (left: number, right: number) => number,
): Piecewise {
  const knots = union(f.xs, g.xs);
  const difference = (x: number): number => evaluate(f, x) - evaluate(g, x);
  const rate = f.slope - g.slope;

  const crossings = knots.flatMap((x, index) => {
    const d = difference(x);
    const next = knots[index + 1];

    if (next === undefined)
      return Math.abs(d) > EPSILON && Math.abs(rate) > EPSILON && Math.sign(d) !== Math.sign(rate)
        ? [x - d / rate]
        : [];

    const e = difference(next);

    return (d > EPSILON && e < -EPSILON) || (d < -EPSILON && e > EPSILON)
      ? [x + ((next - x) * d) / (d - e)]
      : [];
  });

  const xs = union(knots, crossings);
  const end = (xs.at(-1) ?? 0) + 1;
  const fWins = pick(evaluate(f, end), evaluate(g, end)) === evaluate(f, end);

  return fromPoints(
    xs,
    xs.map((x) => pick(evaluate(f, x), evaluate(g, x))),
    fWins ? f.slope : g.slope,
  );
}

function union(left: readonly number[], right: readonly number[]): readonly number[] {
  return [...new Set([...left, ...right])].toSorted((a, b) => a - b);
}

export function fromPoints(xs: readonly number[], ys: readonly number[], slope: number): Piecewise {
  const points = xs.flatMap((x, index) =>
    index === 0 || x - (xs[index - 1] ?? 0) > EPSILON ? [{ x, y: ys[index] ?? 0 }] : [],
  );

  const rate = (index: number): number => {
    const from = points[index];
    const to = points[index + 1];

    return from === undefined || to === undefined ? slope : (to.y - from.y) / (to.x - from.x);
  };

  const kept = points.filter(
    (_, index) => index === 0 || Math.abs(rate(index) - rate(index - 1)) > EPSILON,
  );

  return { xs: kept.map((point) => point.x), ys: kept.map((point) => point.y), slope };
}

function slopes(f: Piecewise): readonly number[] {
  return f.xs.map((x, index) => {
    const next = f.xs[index + 1];
    const y = f.ys[index] ?? 0;
    const nextY = f.ys[index + 1];

    return next === undefined || nextY === undefined ? f.slope : (nextY - y) / (next - x);
  });
}

function format(value: number): string {
  return String(Number(value.toFixed(6)));
}
