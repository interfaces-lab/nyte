import type { ReactNode } from "react";
import { ease, progress } from "./scene-clock";

/*
 * Pieces for scenes drawn as lanes over time. Horizontal positions are
 * percentages of the lane area; vertical ones are pixels from its top.
 * A dashed line is something waiting; an arrow is it landing.
 */

export const GUTTER = "pl-[96px]";

export function percent(time: number, duration: number): number {
  return (time / duration) * 100;
}

export function LaneLabel({ top, name, note }: { top: number; name: string; note?: string }) {
  return (
    <div style={{ top }} className="absolute left-0 w-[88px] font-mono">
      <div className="text-[12px]/4 text-foreground">{name}</div>
      {note ? <div className="text-[11px]/4 text-tertiary-foreground">{note}</div> : null}
    </div>
  );
}

type Tone = "run" | "tool" | "wait" | "child";

const TONES = {
  run: "bg-(--scene-run) text-white dark:text-[#0b0b3a]",
  tool: "bg-(--scene-tool) text-white dark:text-[#1d0b3a]",
  wait: "bg-transparent text-muted-foreground ring-1 ring-foreground/25 ring-inset [background-image:repeating-linear-gradient(135deg,transparent_0_6px,color-mix(in_oklab,var(--color-foreground)_7%,transparent)_6px_12px)]",
  child: "bg-(--scene-run)/15 text-foreground ring-1 ring-(--scene-run)/35 ring-inset",
} as const satisfies Record<Tone, string>;

/* A span of work that grows as the playhead passes over it. */
export function Segment({
  from,
  to,
  time,
  duration,
  top,
  height,
  tone,
  children,
}: {
  from: number;
  to: number;
  time: number;
  duration: number;
  top: number;
  height: number;
  tone: Tone;
  children?: ReactNode;
}) {
  if (time <= from) return null;
  return (
    <div
      style={{
        top,
        height,
        left: `${percent(from, duration)}%`,
        width: `${percent(Math.min(time, to) - from, duration)}%`,
      }}
      className={`absolute flex items-center overflow-clip rounded-[7px] px-2 font-mono text-[11px] whitespace-nowrap ${TONES[tone]}`}
    >
      {children}
    </div>
  );
}

/* A moment every lane shares, such as a response boundary. */
export function Mark({
  at,
  label,
  time,
  duration,
}: {
  at: number;
  label: string;
  time: number;
  duration: number;
}) {
  return (
    <div
      style={{ left: `${percent(at, duration)}%` }}
      className={`absolute top-0 bottom-0 flex flex-col items-center transition-opacity duration-300 ${time >= at ? "opacity-100" : "opacity-40"}`}
    >
      <span className="-translate-x-1/2 font-mono text-[10px]/3 whitespace-nowrap text-muted-foreground">
        {label}
      </span>
      <span className="mt-1 w-0 flex-1 -translate-x-1/2 border-l border-dashed border-foreground/20" />
    </div>
  );
}

export function Playhead({ time, duration }: { time: number; duration: number }) {
  return (
    <div
      style={{ left: `${percent(time, duration)}%` }}
      className="pointer-events-none absolute top-[14px] bottom-0 z-30 w-px bg-foreground/35"
    />
  );
}

/* Waiting in a queue: a dashed line from `from` that grows with time until `to`. */
export function Wait({
  from,
  to,
  top,
  time,
  duration,
}: {
  from: number;
  to: number;
  top: number;
  time: number;
  duration: number;
}) {
  if (time <= from) return null;
  return (
    <span
      style={{
        top,
        left: `${percent(from, duration)}%`,
        width: `${percent(Math.min(time, to) - from, duration)}%`,
      }}
      className={`absolute h-0 border-t-[1.5px] border-dashed transition-colors duration-300 ${time >= to ? "border-(--scene-run)/45" : "border-foreground/35"}`}
    />
  );
}

/* Landing: an arrow that rises at `at` from `from` up to `to`. */
export function Rise({
  at,
  from,
  to,
  time,
  duration,
  offset = 0,
}: {
  at: number;
  from: number;
  to: number;
  time: number;
  duration: number;
  offset?: number;
}) {
  const grown = ease(progress(time, at, 0.3));
  if (grown <= 0) return null;
  const length = (from - to) * grown;
  return (
    <span
      style={{
        left: `calc(${percent(at, duration)}% + ${offset}px)`,
        top: from - length,
        height: length,
      }}
      className="absolute z-20 w-0.5 -translate-x-1/2 bg-(--scene-run)"
    >
      <span className="absolute -top-1 left-1/2 -translate-x-1/2 border-x-4 border-b-[6px] border-x-transparent border-b-(--scene-run)" />
    </span>
  );
}

/* Fades and lifts in at `at`. */
export function appear(time: number, at: number) {
  const shown = ease(progress(time, at, 0.3));
  return { opacity: shown, transform: `translateY(${(1 - shown) * 6}px)` };
}
