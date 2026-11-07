export function fuzzyScore(target: string, query: string): number | undefined {
  const text = target.toLocaleLowerCase();
  const needle = query.trim().toLocaleLowerCase();

  const first = needle[0];

  if (first === undefined) return 0;

  if (text === needle) return 1_000;
  let best: number | undefined;

  for (let start = text.indexOf(first); start >= 0; start = text.indexOf(first, start + 1)) {
    let cursor = start;
    let score = start === 0 ? 80 : 0;
    let previous = start - 1;

    for (const character of needle) {
      cursor = text.indexOf(character, previous + 1);

      if (cursor < 0) break;
      const before = target[cursor - 1];
      const current = target[cursor];

      if (
        before === undefined ||
        /[^\p{L}\p{N}]/u.test(before) ||
        (before !== before.toLocaleUpperCase() && current !== current?.toLocaleLowerCase())
      )
        score += 12;
      score += cursor === previous + 1 ? 8 : -(cursor - previous - 1);
      previous = cursor;
    }

    if (cursor < 0) continue;

    if (start === 0 && text.startsWith(needle)) score += 200;
    score -= target.length / 100;
    best = best === undefined ? score : Math.max(best, score);
  }

  return best;
}
