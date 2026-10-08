"use client";

import { useEffect, useRef, useState } from "react";

const REDUCED = "(prefers-reduced-motion: reduce)";

export interface SceneStep {
  at: number;
  text: string;
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/* How far `time` is through the window that opens at `start`, from 0 to 1. */
export function progress(time: number, start: number, length = 0.35): number {
  return clamp01((time - start) / length);
}

export function ease(value: number): number {
  return 1 - (1 - value) ** 3;
}

export function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

/*
 * A scene's time. It plays once when the scene scrolls into view and stops at
 * the end; reduced motion starts at the end instead. Seeking jumps to a moment.
 */
export function useSceneClock(duration: number) {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const elapsed = useRef(0);
  const target = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = target.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        if (window.matchMedia(REDUCED).matches) {
          elapsed.current = duration;
          setTime(duration);
          return;
        }
        setPlaying(true);
      },
      { threshold: 0.45 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [duration]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const next = Math.min(duration, elapsed.current + (now - last) / 1000);
      last = now;
      elapsed.current = next;
      setTime(next);
      if (next >= duration) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, duration]);

  const seek = (at: number) => {
    elapsed.current = at;
    setTime(at);
    setPlaying(at < duration && !window.matchMedia(REDUCED).matches);
  };

  const toggle = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    seek(elapsed.current >= duration ? 0 : elapsed.current);
  };

  return { clock: { time, duration, playing, seek, toggle }, target };
}

export type SceneClock = ReturnType<typeof useSceneClock>["clock"];
