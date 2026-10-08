"use client";

import { IconArrowRotateCounterClockwise, IconPause, IconPlay } from "central-icons";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import type { SceneClock, SceneStep } from "./scene-clock";

interface SceneFrameProps {
  label: string;
  clock: SceneClock;
  /** The element whose visibility starts the scene. */
  target: RefObject<HTMLElement | null>;
  steps: readonly SceneStep[];
  /** Where the action is, as a fraction of the canvas width, kept in view when the canvas scrolls. */
  follow?: number;
  children: ReactNode;
}

/*
 * The panel a scene plays in. Under the canvas, one line narrates the current
 * step; the numbered buttons jump to each step, so the keyboard sees what motion shows.
 */
export function SceneFrame({ label, clock, target, steps, follow, children }: SceneFrameProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const current = Math.max(
    0,
    steps.findLastIndex((step) => step.at <= clock.time + 0.01),
  );
  const ended = clock.time >= clock.duration;
  const action = clock.playing ? "Pause" : ended ? "Replay" : "Play";

  /* Small moves track the playhead; a jump glides. Swiping the canvas lets go until the next play or step. */
  useEffect(() => {
    const element = viewport.current;
    if (!element || follow === undefined || !pinned.current) return;
    if (element.scrollWidth <= element.clientWidth) return;
    const left = follow * element.scrollWidth - element.clientWidth * 0.45;
    if (Math.abs(left - element.scrollLeft) < element.clientWidth * 0.3) {
      element.scrollLeft = left;
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollTo({ left, behavior: reduced ? "auto" : "smooth" });
  }, [follow]);

  const pin = () => {
    pinned.current = true;
  };

  return (
    <figure
      ref={target}
      aria-label={label}
      className="relative overflow-clip rounded-[20px] bg-(--site-panel) text-left after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-border-subtle [--scene-bad:#e5484d] [--scene-ok:#18a46c] [--scene-run:#2222dd] [--scene-tool:#8b5cf6] dark:[--scene-bad:#ff6b6b] dark:[--scene-ok:#3fd398] dark:[--scene-run:#8f97ff] dark:[--scene-tool:#b49cff]"
    >
      <div
        ref={viewport}
        onPointerDown={() => {
          pinned.current = false;
        }}
        onWheel={(event) => {
          if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) pinned.current = false;
        }}
        className="overflow-x-auto overscroll-x-contain [scrollbar-width:none]"
      >
        <div aria-hidden="true" className="relative min-w-[720px] px-5 pt-5 pb-4 sm:px-6">
          {children}
        </div>
      </div>

      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border-subtle px-4 py-3 sm:px-5">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={action}
            onClick={() => {
              pin();
              clock.toggle();
            }}
            className="mr-1 grid size-7 cursor-pointer place-items-center rounded-full bg-foreground/[0.07] outline-none transition-[background-color,scale] duration-150 hover:bg-foreground/12 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.94]"
          >
            {clock.playing ? <IconPause size={14} /> : null}
            {!clock.playing && ended ? <IconArrowRotateCounterClockwise size={14} /> : null}
            {!clock.playing && !ended ? <IconPlay size={14} /> : null}
          </button>
          <ol className="flex items-center gap-0.5">
            {steps.map((step, index) => (
              <li key={step.at}>
                <button
                  type="button"
                  aria-label={`Step ${index + 1}: ${step.text}`}
                  aria-current={index === current ? "step" : undefined}
                  onClick={() => {
                    pin();
                    clock.seek(step.at);
                  }}
                  className="grid size-7 cursor-pointer place-items-center rounded-full font-mono text-[11px] text-tertiary-foreground tabular-nums outline-none transition-colors duration-150 hover:bg-foreground/[0.07] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-[current=step]:bg-foreground aria-[current=step]:text-background"
                >
                  {index + 1}
                </button>
              </li>
            ))}
          </ol>
        </div>
        <p className="min-w-0 basis-full text-[14px]/5 text-pretty text-foreground sm:basis-0 sm:grow">
          {steps[current]?.text}
        </p>
      </figcaption>
    </figure>
  );
}
