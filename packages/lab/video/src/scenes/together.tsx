import { AbsoluteFill, interpolate, random, useCurrentFrame } from "remotion";
import { clamp, colour, font, Night, Picture, Spoken } from "../look";
import { at, bar, type Cue } from "../timeline";

const columns = 48;

const rows = 21;

const pitch = 40;

/** An army of agents as a field of flickering squares that collapses to two. */
export const Together = ({ cue }: { cue: Cue }) => {
  const frame = useCurrentFrame();
  const one = at(cue, "one");
  const thinking = at(cue, "thinking");
  const collapse = interpolate(frame, [one - 10, one + 6], [1, 0], clamp);
  const pair = interpolate(frame, [one, one + 16], [0, 1], clamp);
  // The two squares take turns, like a conversation, trading every beat.
  const turn = Math.floor(Math.max(0, frame - thinking) / (bar / 4)) % 2;
  const talking = frame >= thinking;

  const square = (lit: boolean, label: string, offset: number) => (
    <div
      style={{
        position: "absolute",
        transform: `translateX(${offset * pair}px)`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 20,
        opacity: pair,
      }}
    >
      <span
        style={{
          width: 36,
          height: 36,
          background: colour.moon,
          opacity: talking && !lit ? 0.35 : 1,
          boxShadow: talking && lit ? `0 0 32px ${colour.moon}` : "none",
        }}
      />
      <span style={{ fontFamily: font.mono, fontSize: 28, color: colour.label }}>{label}</span>
    </div>
  );

  return (
    <Night>
      <Picture>
        <AbsoluteFill style={{ opacity: collapse }}>
          {Array.from({ length: columns * rows }, (_, index) => {
            const flicker = random(`army-${index}-${Math.floor(frame / 3)}`);

            return (
              <span
                key={index}
                style={{
                  position: "absolute",
                  left: (index % columns) * pitch + 16,
                  top: Math.floor(index / columns) * pitch + 16,
                  width: 6,
                  height: 6,
                  background: colour.moon,
                  opacity: flicker > 0.55 ? 0.9 : 0.15,
                }}
              />
            );
          })}
        </AbsoluteFill>
        {square(turn === 0, "you", -110)}
        {square(turn === 1, "agent", 110)}
      </Picture>
      <Spoken cue={cue} tone="#fff" />
    </Night>
  );
};
