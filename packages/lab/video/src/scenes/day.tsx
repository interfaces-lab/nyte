import {
  AbsoluteFill,
  interpolate,
  random,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Brackets, clamp, colour, font, Picture, Spoken } from "../look";
import { at, type Cue } from "../timeline";

const prompt = "Build me an AI app";

const columns = 5;

const rows = 4;

const cardWidth = 300;

const cardHeight = 150;

const gap = 28;

const ChatCard = ({ text, scale }: { text: string; scale: number }) => (
  <div
    style={{
      width: cardWidth,
      height: cardHeight,
      borderRadius: 18,
      background: colour.card,
      boxShadow: "0 1px 2px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.06)",
      padding: 18,
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      transform: `scale(${scale})`,
      fontFamily: font.sans,
    }}
  >
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <span style={{ width: 14, height: 14, borderRadius: 7, background: "#d9d9de" }} />
      <span style={{ width: 70, height: 8, borderRadius: 4, background: "#e4e4e8" }} />
    </div>
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        border: "1px solid #e6e6ea",
        borderRadius: 12,
        padding: "10px 10px 10px 14px",
        fontSize: 15,
        color: colour.ink,
      }}
    >
      <span style={{ opacity: text ? 1 : 0.4 }}>{text || "Ask anything…"}</span>
      <span style={{ width: 22, height: 22, borderRadius: 11, background: colour.ink }} />
    </div>
  </div>
);

/** Twenty interchangeable apps; the centre one is the one being typed. */
const Grid = ({ size, text }: { size: (index: number) => number; text: string }) => (
  <Picture>
    <div
      style={{ display: "grid", gridTemplateColumns: `repeat(${columns}, ${cardWidth}px)`, gap }}
    >
      {Array.from({ length: columns * rows }, (_, index) => (
        <ChatCard key={index} scale={size(index)} text={text} />
      ))}
    </div>
  </Picture>
);

const distance = (index: number) =>
  Math.hypot((index % columns) - 2, Math.floor(index / columns) - 1.5);

export const Weekend = ({ cue }: { cue: Cue }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const typed = prompt.slice(0, Math.floor(frame / 2));
  const multiply = at(cue, "weekend") - 4;
  const solo = interpolate(frame, [multiply - 8, multiply], [1, 0], clamp);

  return (
    <AbsoluteFill style={{ background: colour.day }}>
      <Picture>
        <div style={{ opacity: solo }}>
          <Brackets tone={colour.ink} gap={24} style={{ transform: "scale(1.6)" }}>
            <ChatCard text={typed} scale={1} />
          </Brackets>
        </div>
      </Picture>
      {frame >= multiply - 8 && (
        <Grid
          text={prompt}
          size={(index) =>
            spring({
              frame: frame - multiply - distance(index) * 3,
              fps,
              config: { damping: 14, stiffness: 160 },
            })
          }
        />
      )}
      <Spoken cue={cue} tone={colour.ink} />
    </AbsoluteFill>
  );
};

export const Same = ({ cue }: { cue: Cue }) => {
  const frame = useCurrentFrame();
  const close = at(cue, "close");
  const gone = at(cue, "gone");
  const dark = interpolate(frame, [cue.length - 20, cue.length], [0, 1], clamp);

  return (
    <AbsoluteFill style={{ background: colour.day }}>
      <Grid
        text={prompt}
        size={(index) => {
          const start = close + random(`close-${index}`) * (gone - close);

          return interpolate(frame, [start, start + 8], [1, 0], clamp);
        }}
      />
      <Spoken cue={cue} tone={colour.ink} />
      <AbsoluteFill style={{ background: "#000", opacity: dark }} />
    </AbsoluteFill>
  );
};

/** The thesis on black, one word at a time as it is said, like the Notion film. */
export const Cheap = ({ cue }: { cue: Cue }) => (
  <AbsoluteFill style={{ background: "#000" }}>
    <Spoken cue={cue} tone="#fff" />
  </AbsoluteFill>
);
