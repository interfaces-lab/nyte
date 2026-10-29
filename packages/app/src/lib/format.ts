export function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
}

export function formatUsd(dollars: number): string {
  if (dollars === 0) return "$0.00";

  if (dollars < 0.01) return "<$0.01";
  const fixed = dollars.toFixed(2);

  return `$${groupDigits(fixed.slice(0, -3))}${fixed.slice(-3)}`;
}

export function formatTokens(tokens: number): string {
  if (tokens < 1_000) return String(Math.round(tokens));

  if (tokens < 1_000_000) return `${(tokens / 1_000).toFixed(tokens < 10_000 ? 1 : 0)}K`;

  if (tokens < 1_000_000_000)
    return `${(tokens / 1_000_000).toFixed(tokens < 10_000_000 ? 2 : 1)}M`;

  return `${(tokens / 1_000_000_000).toFixed(2)}B`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value < 10 ? value.toFixed(1) : String(Math.round(value))} ${units[unit] ?? "GB"}`;
}

export function formatPercent(fraction: number): string {
  if (fraction <= 0) return "0%";

  if (fraction < 0.01) return "<1%";

  return `${String(Math.round(fraction * 100))}%`;
}

export function formatTimeAgo(timestamp: number, now: number): string {
  const elapsed = Math.max(0, now - timestamp);
  const minutes = Math.floor(elapsed / 60_000);

  if (minutes < 1) return "now";

  if (minutes < 60) return `${String(minutes)}m`;
  const hours = Math.floor(minutes / 60);

  if (hours < 24) return `${String(hours)}h`;
  const days = Math.floor(hours / 24);

  if (days < 7) return `${String(days)}d`;

  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
