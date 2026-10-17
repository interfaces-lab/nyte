import type { Account } from "./fixtures";

const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const dayLabel = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "2-digit",
  timeZone: "UTC",
});

const dayLong = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "2-digit",
  timeZone: "UTC",
});

const hourLabel = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

export const usd = (value: number): string =>
  Math.abs(value) >= 10_000 ? usdCompact.format(value) : usd2.format(value);

export const usdTick = (value: number): string =>
  value >= 1000 ? usdCompact.format(value) : `$${whole.format(value)}`;

export const tokens = (value: number): string => compact.format(value);

export const count = (value: number): string => whole.format(value);

export const pct = (share: number, digits = 0): string => `${(share * 100).toFixed(digits)}%`;

function direction(change: number): -1 | 0 | 1 {
  if (Math.abs(change) < 0.005) return 0;

  return change > 0 ? 1 : -1;
}

export function delta(current: number, previous: number) {
  const change = previous === 0 ? 0 : (current - previous) / previous;

  return {
    text:
      previous === 0 ? "—" : `${change >= 0 ? "+" : "−"}${(Math.abs(change) * 100).toFixed(1)}%`,
    sign: direction(change),
  };
}

export function duration(minutes: number): string {
  if (minutes < 60) return `${String(Math.max(1, Math.round(minutes)))}m`;

  if (minutes < 1440) {
    const hours = Math.floor(minutes / 60);
    const rest = Math.round(minutes % 60);

    return rest === 0 ? `${String(hours)}h` : `${String(hours)}h ${String(rest)}m`;
  }

  return `${String(Math.floor(minutes / 1440))}d ${String(Math.round((minutes % 1440) / 60))}h`;
}

export const bucketLabel = (start: number, unit: "hour" | "day"): string =>
  unit === "hour" ? hourLabel.format(start) : dayLabel.format(start);

export const bucketTitle = (start: number, unit: "hour" | "day"): string =>
  unit === "hour" ? `${dayLong.format(start)} ${hourLabel.format(start)}` : dayLong.format(start);

export function project(account: Account) {
  const now = account.samples.length - 1;
  const used = account.samples.at(-1) ?? 0;
  const pace = (used - (account.samples.at(-3) ?? 0)) / Math.max(1, Math.min(2, now));
  const atReset = used + pace * (account.steps - now);
  const fillsIn = pace > 0 && atReset >= 100 ? ((100 - used) / pace) * account.stepMinutes : null;

  return {
    used,
    pacePerHour: (pace / account.stepMinutes) * 60,
    atReset: Math.min(atReset, 999),
    fillsIn,
    resetsIn: (account.steps - now) * account.stepMinutes,
  };
}
