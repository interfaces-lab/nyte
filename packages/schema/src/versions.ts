const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/u;

/** Orders two semver versions by precedence: below zero when `left` is older, zero when they tie, above zero when it is newer, and null when either isn't semver. */
export function compareVersions(left: string, right: string): number | null {
  const next = SEMVER.exec(left.trim());
  const now = SEMVER.exec(right.trim());

  if (next === null || now === null) return null;

  for (const index of [1, 2, 3]) {
    const order = Number(next[index]) - Number(now[index]);

    if (order !== 0) return order;
  }

  return comparePrerelease(next[4], now[4]);
}

function comparePrerelease(left: string | undefined, right: string | undefined): number {
  if (left === undefined || right === undefined) {
    return (left === undefined ? 1 : 0) - (right === undefined ? 1 : 0);
  }

  const lefts = left.split(".");
  const rights = right.split(".");

  for (let index = 0; index < Math.min(lefts.length, rights.length); index++) {
    const order = compareIdentifier(lefts[index] ?? "", rights[index] ?? "");

    if (order !== 0) return order;
  }

  return lefts.length - rights.length;
}

function compareIdentifier(left: string, right: string): number {
  const numbers = /^\d+$/u;

  if (numbers.test(left) && numbers.test(right)) return Number(left) - Number(right);

  if (numbers.test(left) !== numbers.test(right)) return numbers.test(left) ? -1 : 1;

  return left < right ? -1 : left > right ? 1 : 0;
}
