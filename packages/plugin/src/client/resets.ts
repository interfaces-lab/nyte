const MINUTE_MS = 60_000;

const HOUR_MS = 60 * MINUTE_MS;

const DAY_MS = 24 * HOUR_MS;

export function formatResetsIn(at: number, now: number): string {
  const left = at - now;

  if (left <= 0) return "now";

  if (left < MINUTE_MS) return "less than a minute";
  const days = Math.floor(left / DAY_MS);
  const hours = Math.floor((left % DAY_MS) / HOUR_MS);
  const minutes = Math.floor((left % HOUR_MS) / MINUTE_MS);

  if (days > 0) return hours === 0 ? `${String(days)}d` : `${String(days)}d ${String(hours)}h`;

  if (hours > 0) {
    return minutes === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(minutes)}m`;
  }

  return `${String(minutes)}m`;
}
