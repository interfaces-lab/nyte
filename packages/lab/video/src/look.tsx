import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import moon from "../moon.json";
import type { Word } from "./manifest";
import { fps, type Cue } from "./timeline";

/** Night comes from the app icon; day is the flat grey of the rajz reference. */
export const colour = {
  night: "#0c1020",
  plate: "#232a44",
  moon: "#c1d0f6",
  dim: "rgba(193, 208, 246, 0.22)",
  label: "rgba(193, 208, 246, 0.72)",
  day: "#ececec",
  ink: "#16181d",
  card: "#ffffff",
};

export const font = {
  sans: "'Inter Variable', Inter, system-ui, sans-serif",
  mono: "'SF Mono', ui-monospace, Menlo, monospace",
};

export const Night = ({ children }: { children?: ReactNode }) => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(120% 90% at 50% 0%, ${colour.plate} 0%, ${colour.night} 70%)`,
      fontFamily: font.sans,
    }}
  >
    {children}
  </AbsoluteFill>
);

/** Corner ticks around a block of content, the framing device from the rajz reference. */
export const Brackets = ({
  children,
  tone,
  gap = 28,
  style,
}: {
  children: ReactNode;
  tone: string;
  gap?: number;
  style?: CSSProperties;
}) => {
  const tick = {
    position: "absolute",
    width: 6,
    height: 6,
    background: tone,
  } satisfies CSSProperties;

  return (
    <div style={{ position: "relative", padding: gap, ...style }}>
      <span style={{ ...tick, left: 0, top: 0 }} />
      <span style={{ ...tick, right: 0, top: 0 }} />
      <span style={{ ...tick, left: 0, bottom: 0 }} />
      <span style={{ ...tick, right: 0, bottom: 0 }} />
      {children}
    </div>
  );
};

/** The icon as a grid of squares. `shown` decides, per cell, how far it has appeared. */
export const PixelMoon = ({
  size,
  shown,
}: {
  size: number;
  shown: (x: number, y: number) => number;
}) => {
  const cell = size / moon.size;

  return (
    <div style={{ position: "relative", width: size, height: size }}>
      {moon.cells.map(({ x, y, lit }) => {
        const progress = shown(x, y);

        return (
          <span
            key={`${x}-${y}`}
            style={{
              position: "absolute",
              left: x * cell + cell * 0.1,
              top: y * cell + cell * 0.1,
              width: cell * 0.8,
              height: cell * 0.8,
              background: lit ? colour.moon : colour.dim,
              opacity: progress,
              transform: `scale(${0.4 + progress * 0.6})`,
            }}
          />
        );
      })}
    </div>
  );
};

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Height of the band under the picture where the line sits, so words never cross the image. */
const band = 240;

export const Picture = ({ children }: { children: ReactNode }) => (
  <AbsoluteFill
    style={{
      bottom: band,
      height: "auto",
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    }}
  >
    {children}
  </AbsoluteFill>
);

/** Short subtitles, broken after punctuation or at six words, the way the Notion film sets them. */
const subtitles = (words: readonly Word[]) => {
  const groups: Word[] = [];
  let open = true;

  for (const word of words) {
    const last = groups.at(-1);

    if (open || !last || last.text.split(" ").length >= 6) groups.push({ ...word });
    else {
      last.text += ` ${word.text}`;
      last.end = word.end;
    }

    open = /[.,]$/.test(word.text);
  }

  return groups;
};

/** Every spoken word is on screen once: as a subtitle under the picture, or alone on black as it is said. */
export const Spoken = ({ cue, tone }: { cue: Cue; tone: string }) => {
  const frame = useCurrentFrame();
  const seconds = frame / fps;

  if (cue.show === "none") return null;
  const groups = cue.show === "words" ? cue.words : subtitles(cue.words);
  const index = groups.findLastIndex((group) => group.start <= seconds);
  const current = groups[index];

  if (!current) return null;
  // A subtitle stays until the next one; the last one clears shortly after the voice stops.
  const until = (groups[index + 1]?.start ?? current.end + 0.6) * fps;
  const since = frame - current.start * fps;

  const opacity = Math.min(
    interpolate(since, [0, 4], [0, 1], clamp),
    interpolate(frame, [until - 4, until], [1, 0], clamp),
  );

  if (cue.show === "words")
    return (
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            fontFamily: font.sans,
            fontSize: 128,
            fontWeight: 600,
            letterSpacing: -3,
            color: tone,
            opacity,
          }}
        >
          {current.text.replace(/[.,]$/, "")}
        </div>
      </AbsoluteFill>
    );

  return (
    <AbsoluteFill
      style={{
        top: "auto",
        height: band,
        alignItems: "center",
        justifyContent: "flex-end",
        paddingBottom: 56,
      }}
    >
      <div
        style={{
          maxWidth: 1600,
          fontFamily: font.sans,
          fontSize: 64,
          fontWeight: 400,
          letterSpacing: -0.6,
          lineHeight: 1.15,
          textAlign: "center",
          textWrap: "balance",
          color: tone,
          opacity,
        }}
      >
        {current.text}
      </div>
    </AbsoluteFill>
  );
};
