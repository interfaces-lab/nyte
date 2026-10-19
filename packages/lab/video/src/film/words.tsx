import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { BOX, CheckCycle } from "../snap-cn/check-cycle";
import { cut, findWord, fps, nextLine } from "./cut";
import type { Line } from "./cut";
import { ditherStyle, palette } from "./dither";
import type { LineName } from "./script";
import { Words, font, progress } from "./type";

/**
 * How each line is set, in Geist throughout, the way Notion's film sets its narration: a caption
 * under the picture, a phrase at a time; a statement alone on black, a word at
 * a time; a headline over the product, building word by word; or the
 * "Your ☑ …" sentence, rolling to each part as it is named.
 */
const settings: Record<LineName, "caption" | "statement" | "headline" | "sentence"> = {
  blocks: "caption",
  stacked: "caption",
  world: "caption",
  beneath: "statement",
  harness: "caption",
  factory: "caption",
  foundation: "caption",
  consistency: "caption",
  rewrite: "caption",
  wrong: "statement",
  nyte: "headline",
  parts: "sentence",
  top: "headline",
  machine: "headline",
  open: "headline",
  own: "statement",
};

/** Where a caption breaks into the phrases shown one after the other, by word index. */
const phrases: Partial<Record<LineName, readonly number[]>> = {
  stacked: [3],
  world: [3],
  harness: [5, 9],
  factory: [2, 5, 8],
};

/** The parts the sentence rolls through, each with the spoken word it rolls on. */
export const parts = [
  { label: "Skills", word: "skills" },
  { label: "Subagents", word: "subagents" },
  { label: "MCP servers", word: "mcp" },
  { label: "Canvases", word: "canvases" },
  { label: "Models", word: "models" },
] as const;

/** A word shows two frames before it is spoken, so it is there when it is heard. */
const lead = 2;

/** The frame, in the line's own frames, a word shows on. */
const cue = (line: Line, word: Line["words"][number]) => word.at - line.from - lead;

/** The line's phrases, each with the frame it shows on in the line's own frames. */
function splitPhrases(line: Line) {
  const starts = [0, ...(phrases[line.name] ?? [])];
  return starts.map((start, index) => {
    const words = line.words.slice(start, starts[index + 1]);
    return { text: words.map((word) => word.text).join(" "), from: words[0] ? cue(line, words[0]) : 0 };
  });
}

function Caption({ line }: { readonly line: Line }) {
  const frame = useCurrentFrame();
  const shown = splitPhrases(line).findLast((phrase) => phrase.from <= frame);
  if (!shown) return null;
  return (
    <>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 300, background: "linear-gradient(to bottom, transparent, rgb(3 3 15 / 0.62))" }} />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 88,
          textAlign: "center",
          fontFamily: font.sans,
          fontSize: 46,
          fontWeight: 500,
          letterSpacing: "-0.01em",
          color: palette.white,
          textShadow: "0 2px 18px rgb(3 3 15 / 0.9), 0 0 3px rgb(3 3 15 / 0.8)",
          ...ditherStyle(progress(frame, shown.from, 3), 2),
        }}
      >
        {shown.text}
      </div>
    </>
  );
}

/** Frames the last word of a statement holds after the line is said, before the screen goes black. */
const hold = 10;

/** One word at a time, alone in the middle of the black, hard cut on the voice. */
function Statement({ line }: { readonly line: Line }) {
  const frame = useCurrentFrame();
  const word = line.words.findLast((entry) => cue(line, entry) <= frame);
  if (!word || frame > line.until - line.from + hold) return null;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ fontFamily: font.sans, fontSize: 96, fontWeight: 500, lineHeight: 1, color: palette.white, letterSpacing: "-0.02em" }}>
        {word.text.replace(/[.,]/gu, "")}
      </div>
    </AbsoluteFill>
  );
}

/** The headline over the product, a word at a time, staying until the next line. */
function Headline({ line }: { readonly line: Line }) {
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 104, display: "flex", justifyContent: "center" }}>
      <Words size={72} align="center" words={line.words.map((word) => ({ text: word.text, from: cue(line, word) }))} />
    </div>
  );
}

/** snapcn's ticked box: a rounded blue square with a white tick, in the box's own units. */
function Checkbox() {
  return (
    <>
      <rect width={BOX.w} height={BOX.h} rx={6.53} fill={palette.lift} />
      <polyline points="5.468,13.785 11.827,18.695 20.72,8.888" fill="none" stroke={palette.white} strokeWidth={2.72} strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

/** "Your ☑ …" over the product: each part rolls into the slot as the narrator names it. */
function Sentence({ line }: { readonly line: Line }) {
  const frame = useCurrentFrame();
  const rolls = parts.slice(1).map((part) => (findWord(line, part.word).at - 9 - line.from) / fps);
  return (
    <AbsoluteFill style={{ transform: "translateY(-394px)", ...ditherStyle(progress(frame, 0, 6), 3) }}>
      <CheckCycle headline="Your" words={parts.map((part) => part.label)} rolls={rolls} checkbox={<Checkbox />} color={palette.white} fontFamily={font.sans} fontWeight={500} scale={1.5} />
    </AbsoluteFill>
  );
}

/** One line as text, in its setting. Inside its sequence, frames count from the line's start. */
function Setting({ line }: { readonly line: Line }) {
  switch (settings[line.name]) {
    case "caption":
      return <Caption line={line} />;
    case "statement":
      return <Statement line={line} />;
    case "headline":
      return <Headline line={line} />;
    case "sentence":
      return <Sentence line={line} />;
  }
}

/** Every line of the narration as text, each from the frame it is spoken until the next one starts. */
export function Narration() {
  return (
    <>
      {cut.lines.map((line) => (
        <Sequence key={line.name} from={line.from} durationInFrames={(nextLine(line)?.from ?? cut.lockup) - line.from} layout="none">
          <Setting line={line} />
        </Sequence>
      ))}
    </>
  );
}
