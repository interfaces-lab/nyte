import type { ReactNode } from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { clamp, colour, font, Night, Picture, PixelMoon, Spoken } from "../look";
import { at, type Cue } from "../timeline";

/** Frame counts of the Blender shots in `blender/moon.py`. */
const shot = { rise: 150, phases: 210 };

const still = (name: string, pass: string, index: number) =>
  staticFile(`blender/${name}/${pass}/${String(index).padStart(4, "0")}.png`);

/** Fit a Blender shot to the cue by mapping its frames across the cue's length. */
const shotFrame = (frame: number, length: number, frames: number) =>
  Math.min(frames, Math.max(1, Math.round((frame / length) * frames) + 1));

/** Blender renders at 16:9; the frame is letterboxed into the picture area above the line. */
const Render = ({ children }: { children: ReactNode }) => (
  <Picture>
    <div style={{ position: "relative", height: "100%", aspectRatio: "16 / 9" }}>{children}</div>
  </Picture>
);

const render = { position: "absolute", inset: 0, width: "100%", height: "100%" } as const;

export const Longer = ({ cue }: { cue: Cue }) => {
  const frame = useCurrentFrame();
  const index = shotFrame(frame, cue.length, shot.rise);
  // The heat pass gives way to the finished render, scanning down the frame.
  const reveal = interpolate(frame, [cue.length * 0.25, cue.length * 0.75], [0, 100], clamp);

  return (
    <Night>
      <Render>
        <Img src={still("rise", "heat", index)} style={render} />
        <Img
          src={still("rise", "beauty", index)}
          style={{ ...render, clipPath: `inset(0 0 ${100 - reveal}% 0)` }}
        />
        {reveal > 0 && reveal < 100 && (
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: `${reveal}%`,
              height: 2,
              background: colour.moon,
              boxShadow: `0 0 24px ${colour.moon}`,
            }}
          />
        )}
      </Render>
      <Spoken cue={cue} tone="#fff" />
    </Night>
  );
};

export const Phases = ({ cue }: { cue: Cue }) => {
  const frame = useCurrentFrame();

  return (
    <Night>
      <Render>
        <Img
          src={still("phases", "beauty", shotFrame(frame, cue.length, shot.phases))}
          style={render}
        />
      </Render>
      <Spoken cue={cue} tone="#fff" />
    </Night>
  );
};

export const End = ({ cue }: { cue: Cue }) => {
  const frame = useCurrentFrame();
  const sleep = at(cue, "sleep");
  const lift = interpolate(frame, [sleep - 6, sleep + 10], [0, -36], clamp);
  const fadeOut = interpolate(frame, [cue.length - 24, cue.length], [1, 0], clamp);

  return (
    <Night>
      <AbsoluteFill
        style={{ alignItems: "center", justifyContent: "center", gap: 28, opacity: fadeOut }}
      >
        <div style={{ transform: `translateY(${lift}px)`, marginBottom: 12 }}>
          <PixelMoon
            size={240}
            shown={(x, y) =>
              interpolate(frame, [(x + 11 - y) * 1.2, (x + 11 - y) * 1.2 + 8], [0, 1], clamp)
            }
          />
        </div>
        <div
          style={{
            fontFamily: font.sans,
            fontSize: 72,
            fontWeight: 600,
            letterSpacing: -1,
            color: "#fff",
            opacity: interpolate(frame, [10, 22], [0, 1], clamp),
            transform: `translateY(${lift}px)`,
          }}
        >
          Nyte
        </div>
        <div
          style={{
            height: 52,
            fontFamily: font.sans,
            fontSize: 44,
            fontWeight: 500,
            color: colour.moon,
            opacity: interpolate(frame, [sleep, sleep + 10], [0, 1], clamp),
            transform: `translateY(${lift}px)`,
          }}
        >
          Sleep on it.
        </div>
      </AbsoluteFill>
    </Night>
  );
};
