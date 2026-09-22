import { useEffect, useState } from "react";
import type { ReactElement } from "react";

function useNow(until: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (now >= until) return undefined;

    const timer = window.setTimeout(
      () => setNow((current) => Math.min(until, Math.max(current, Date.now()))),
      Math.min(1_000, until - now),
    );

    return () => window.clearTimeout(timer);
  }, [now, until]);

  return now;
}

export function formatCountdown(remainingMs: number): string {
  const total = Math.max(0, Math.ceil(remainingMs / 1_000));
  const seconds = String(total % 60).padStart(2, "0");
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3_600);

  if (hours > 0) return `${String(hours)}:${String(minutes).padStart(2, "0")}:${seconds}`;

  return `${String(minutes)}:${seconds}`;
}

export function Countdown({ until }: { until: number }): ReactElement {
  const now = useNow(until);

  return <>{`· ${formatCountdown(until - now)}`}</>;
}
