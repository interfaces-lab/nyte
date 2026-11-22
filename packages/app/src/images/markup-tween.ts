import { animate } from "motion/react";

const EASE = [0.16, 1, 0.3, 1] as const;

export function tween(duration: number, frame: (t: number) => void, done?: () => void): () => void {
  if (duration <= 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    frame(1);
    done?.();

    return () => undefined;
  }

  const controls = animate(0, 1, {
    duration: duration / 1000,
    ease: EASE,
    onUpdate: frame,
    onComplete: done,
  });

  return () => controls.stop();
}
