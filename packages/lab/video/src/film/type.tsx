import "@fontsource-variable/geist";
import type { CSSProperties } from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { ditherStyle, palette } from "./dither";

/** The film's one typeface. */
export const font = { sans: "'Geist Variable', sans-serif" } as const;

export const ease = Easing.bezier(0.16, 1, 0.3, 1);

export function progress(frame: number, from: number, duration: number, easing = ease) {
  return interpolate(frame, [from, from + duration], [0, 1], {
    easing,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

export interface Word {
  readonly text: string;
  readonly from: number;
  /** Start a new line before this word. */
  readonly breaks?: boolean;
  readonly color?: string;
}

interface WordsProps {
  readonly words: readonly Word[];
  readonly size: number;
  readonly family?: string;
  readonly color?: string;
  readonly weight?: number;
  /** The frame the line starts dissolving away. */
  readonly exit?: number;
  readonly align?: CSSProperties["textAlign"];
  readonly leading?: number;
  readonly tracking?: string;
  readonly style?: CSSProperties;
}

/**
 * Each letter dithers in on its word's cue and rises a little, the way the
 * plate's headline rises; on `exit` the letters dissolve back into the dark.
 */
export function Words({
  words,
  size,
  family = font.sans,
  color = palette.white,
  weight = 500,
  exit,
  align = "left",
  leading = 1.02,
  tracking = "-0.02em",
  style,
}: WordsProps) {
  const frame = useCurrentFrame();
  const cell = Math.max(2, Math.round(size / 40));
  const first = words[0]?.from ?? 0;

  const push =
    1 +
    0.04 *
      interpolate(frame, [first, first + 180], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });

  const split = words.map((word) =>
    Array.from(graphemes.segment(word.text), (part) => part.segment),
  );

  const starts = split.map((_, index) =>
    split.slice(0, index).reduce((sum, letters) => sum + letters.length, 0),
  );

  return (
    <div
      style={{
        fontFamily: family,
        fontSize: size,
        fontWeight: weight,
        lineHeight: leading,
        letterSpacing: tracking,
        color,
        textAlign: align,
        transform: `scale(${push})`,
        transformOrigin: align === "center" ? "50% 50%" : "0 50%",
        ...style,
      }}
    >
      {words.map((word, index) => {
        const letters = split[index] ?? [];

        return (
          <span key={index}>
            {word.breaks ? <br /> : index > 0 ? " " : null}
            <span style={{ display: "inline-block", whiteSpace: "pre", color: word.color }}>
              {letters.map((letter, position) => {
                const order = (starts[index] ?? 0) + position;
                const enter = progress(frame, word.from + position * 1.2, 8);
                const leave = exit === undefined ? 0 : progress(frame, exit + order * 0.5, 7);
                const rise = (1 - progress(frame, word.from + position * 1.2, 14)) * size * 0.12;

                return (
                  <span
                    key={position}
                    style={{
                      display: "inline-block",
                      transform: `translateY(${rise}px)`,
                      ...ditherStyle(enter - leave, cell),
                    }}
                  >
                    {letter}
                  </span>
                );
              })}
            </span>
          </span>
        );
      })}
    </div>
  );
}
