import { useCallback, useEffect, useRef, useState } from "react";
import { DURATION } from "./scenario";

export interface Playback {
  /** Demo seconds, 0 to `duration`. */
  readonly time: number;
  readonly duration: number;
  readonly playing: boolean;
  readonly speed: number;
  readonly play: () => void;
  readonly pause: () => void;
  readonly toggle: () => void;
  readonly seek: (time: number) => void;
  readonly restart: () => void;
  readonly setSpeed: (speed: number) => void;
}

/** `?t=30` opens every demo paused at that second, for screenshots and links. */
function pinnedTime(): number | undefined {
  const value = new URLSearchParams(window.location.search).get("t");

  return value === null || Number.isNaN(Number(value)) ? undefined : Number(value);
}

/**
 * One clock per demo. Stops at the end so the merged state stays on screen;
 * `loop` holds the end for two seconds and starts over instead.
 */
export function usePlayback(
  options: {
    readonly autoplay?: boolean;
    readonly loop?: boolean;
    readonly duration?: number;
  } = {},
): Playback {
  const duration = options.duration ?? DURATION;
  const loop = options.loop === true;
  const pinned = pinnedTime();
  const [time, setTime] = useState(pinned ?? 0);
  const [playing, setPlaying] = useState(pinned === undefined && (options.autoplay ?? true));
  const [speed, setSpeed] = useState(1);
  const clock = useRef(pinned ?? 0);

  const seek = useCallback(
    (next: number) => {
      clock.current = Math.min(duration, Math.max(0, next));
      setTime(clock.current);
    },
    [duration],
  );

  useEffect(() => {
    if (!playing) return;

    let previous: number | undefined;
    let frame = requestAnimationFrame(function tick(now) {
      const next = clock.current + ((now - (previous ?? now)) / 1000) * speed;
      previous = now;

      if (next >= duration + (loop ? 2 : 0)) {
        if (!loop) {
          seek(duration);
          setPlaying(false);
          return;
        }

        seek(0);
      } else {
        clock.current = next;
        setTime(Math.min(next, duration));
      }

      frame = requestAnimationFrame(tick);
    });

    return () => cancelAnimationFrame(frame);
  }, [playing, speed, duration, loop, seek]);

  const restart = (): void => {
    seek(0);
    setPlaying(true);
  };

  return {
    time,
    duration,
    playing,
    speed,
    play: () => {
      if (clock.current >= duration) seek(0);
      setPlaying(true);
    },
    pause: () => setPlaying(false),
    toggle: () => {
      if (playing) return setPlaying(false);
      if (clock.current >= duration) seek(0);
      setPlaying(true);
    },
    seek,
    restart,
    setSpeed,
  };
}
