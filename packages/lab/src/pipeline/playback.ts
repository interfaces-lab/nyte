import { useCallback, useEffect, useRef, useState } from "react";
import { DURATION } from "./scenario";

export interface Playback {
  /** Demo seconds, 0 to `DURATION`. */
  readonly time: number;
  readonly playing: boolean;
  readonly speed: number;
  readonly play: () => void;
  readonly pause: () => void;
  readonly toggle: () => void;
  readonly seek: (time: number) => void;
  readonly restart: () => void;
  readonly setSpeed: (speed: number) => void;
}

/**
 * One clock per demo. Stops at the end rather than looping, so the merged
 * state stays on screen; `loop` restarts after a beat instead.
 */
export function usePlayback(
  options: { readonly autoplay?: boolean; readonly loop?: boolean; readonly duration?: number } = {},
): Playback {
  const duration = options.duration ?? DURATION;
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(options.autoplay ?? true);
  const [speed, setSpeed] = useState(1);
  const last = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!playing) {
      last.current = undefined;
      return;
    }

    let frame = requestAnimationFrame(function tick(now) {
      const previous = last.current ?? now;
      last.current = now;
      setTime((current) => {
        const next = current + ((now - previous) / 1000) * speed;

        if (next < duration) return next;
        if (options.loop === true) return next > duration + 2 ? 0 : next;

        setPlaying(false);

        return duration;
      });
      frame = requestAnimationFrame(tick);
    });

    return () => cancelAnimationFrame(frame);
  }, [playing, speed, duration, options.loop]);

  const seek = useCallback(
    (next: number) => setTime(Math.min(duration, Math.max(0, next))),
    [duration],
  );

  return {
    time: Math.min(time, duration),
    playing,
    speed,
    play: () => {
      if (time >= duration) setTime(0);
      setPlaying(true);
    },
    pause: () => setPlaying(false),
    toggle: () => {
      if (!playing && time >= duration) setTime(0);
      setPlaying(!playing);
    },
    seek,
    restart: () => {
      setTime(0);
      setPlaying(true);
    },
    setSpeed,
  };
}
