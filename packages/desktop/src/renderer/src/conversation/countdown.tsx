/**
 * Time left until a parked call wakes. The clock is mounted only while
 * something counts down, so a settled transcript never ticks.
 */
import { useEffect, useState } from "react";
import type { ReactElement } from "react";

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
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
  const now = useNow();
  return <>{`· ${formatCountdown(until - now)}`}</>;
}
