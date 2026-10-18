import "@fontsource/geist-pixel";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import type { CSSProperties, ReactNode } from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { ditherStyle, palette } from "./dither";

export const font = {
  pixel: "'Geist Pixel', 'Geist Variable', sans-serif",
  sans: "'Geist Variable', sans-serif",
  mono: "'Geist Mono Variable', monospace",
} as const;

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
  family = font.pixel,
  color = palette.white,
  weight = 400,
  exit,
  align = "left",
  leading = 1.02,
  tracking = "-0.01em",
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

/** Words from one voice line, each shown on the frame it is spoken. */
export function sentence(text: string, cues: readonly number[], breaks: readonly number[] = []) {
  return text.split(" ").map((part, index) => ({
    text: part,
    from: cues[index] ?? cues[cues.length - 1] ?? 0,
    breaks: breaks.includes(index),
  }));
}

interface WheelProps {
  readonly items: readonly ReactNode[];
  /** Which item shows; a fraction is how far the next one has rolled in. */
  readonly position: number;
  readonly height: number;
  readonly align?: CSSProperties["textAlign"];
}

/** A slot window: items stacked in a column that scrolls up through it. */
export function Wheel({ items, position, height, align }: WheelProps) {
  return (
    <span style={{ display: "inline-block", height, overflow: "hidden", verticalAlign: "bottom" }}>
      <span
        style={{
          display: "flex",
          flexDirection: "column",
          transform: `translateY(${-position * height}px)`,
        }}
      >
        {items.map((item, index) => (
          <span
            key={index}
            style={{ height, lineHeight: `${height}px`, whiteSpace: "pre", textAlign: align }}
          >
            {item}
          </span>
        ))}
      </span>
    </span>
  );
}

/** How many of `at` cues have rolled by `frame`, eased across each roll. */
export function rolled(frame: number, at: readonly number[], duration = 12) {
  return at.reduce((sum, from) => sum + progress(frame, from, duration), 0);
}
