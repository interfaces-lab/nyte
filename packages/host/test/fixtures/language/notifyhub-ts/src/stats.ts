/** How many messages were submitted and how they ended. */
export interface Counts {
  submitted: number;
  delivered: number;
  failed: number;
}

/**
 * The totals and the same counts per channel. A message for a channel nobody registered counts
 * in `total` only.
 */
export interface Stats {
  total: Counts;
  channels: Record<string, Counts>;
}

export function emptyStats(): Stats {
  return { total: { submitted: 0, delivered: 0, failed: 0 }, channels: {} };
}

export function record(stats: Stats, channel: string | undefined, delivered: boolean): Stats {
  const next: Stats = { total: bump(stats.total, delivered), channels: { ...stats.channels } };
  if (channel !== undefined) {
    next.channels[channel] = bump(stats.channels[channel] ?? emptyStats().total, delivered);
  }
  return next;
}

/** Channel names in alphabetical order. */
export function channelNames(stats: Stats): string[] {
  return Object.keys(stats.channels).sort();
}

function bump(counts: Counts, delivered: boolean): Counts {
  return {
    submitted: counts.submitted + 1,
    delivered: counts.delivered + (delivered ? 1 : 0),
    failed: counts.failed + (delivered ? 0 : 1),
  };
}
