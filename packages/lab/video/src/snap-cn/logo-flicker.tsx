import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";

/**
 * Logo Flicker, adapted from snapcn (snapcndev/snapcn@47ee435, MIT; see
 * THIRD-PARTY-NOTICES.md). Shots flip across the screen, the flicker slows and
 * fades, and the logo and name resolve underneath it in one move: the flicker
 * fades out on exactly the frames the logo fades in.
 *
 * The film's changes: a shot is any React node rather than an image URL; the
 * caller sets the frame each shot cuts in on, so the flips can land on the
 * score's beats and slow down with it; and the caller can replace the
 * cross-fade's opacity with its own dissolve.
 */

const EASE = Easing.bezier(0.2, 0.6, 0.35, 1);
const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export interface LogoFlickerProps {
  /** What flips past, full-screen, in order. */
  readonly shots: readonly ReactNode[];
  /** The frame each shot cuts in on, rising. */
  readonly cuts: readonly number[];
  /** The frames the last shot fades out and the logo fades in over. */
  readonly fade: readonly [number, number];
  /** The logo and name the flicker resolves into. */
  readonly children: ReactNode;
  /** How a layer shows at `progress`, 0 hidden to 1 whole: an opacity fade unless given. */
  readonly dissolve?: (progress: number) => CSSProperties;
}

const opacity = (progress: number): CSSProperties => ({ opacity: progress });

export function LogoFlicker({ shots, cuts, fade, children, dissolve = opacity }: LogoFlickerProps) {
  const frame = useCurrentFrame();
  const reveal = interpolate(frame, [fade[0], fade[1]], [0, 1], CLAMP);
  const settle = interpolate(frame, [fade[0], fade[1]], [0.92, 1], { ...CLAMP, easing: EASE });
  const shot = shots[cuts.findLastIndex((at) => at <= frame)];

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {reveal < 1 && shot !== undefined && <AbsoluteFill style={dissolve(1 - reveal)}>{shot}</AbsoluteFill>}
      {reveal > 0 && <AbsoluteFill style={{ ...dissolve(reveal), transform: `scale(${settle})` }}>{children}</AbsoluteFill>}
    </AbsoluteFill>
  );
}
