export function quantile(values: readonly number[], q: number): number {
  const sorted = values.toSorted((first, second) => first - second);
  const position = (sorted.length - 1) * q;
  const lower = sorted[Math.floor(position)] ?? Number.NaN;
  const upper = sorted[Math.ceil(position)] ?? lower;

  return lower + (upper - lower) * (position - Math.floor(position));
}

export function median(values: readonly number[]): number {
  return quantile(values, 0.5);
}

export function spread(values: readonly number[]) {
  return { min: Math.min(...values), max: Math.max(...values) };
}

export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
