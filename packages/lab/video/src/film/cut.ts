import { length as lockupLength } from "./ending";
import { script } from "./script";
import type { LineName } from "./script";
import voice from "./voice.json";

export const fps = 30;
/** The score runs at 120 BPM: a beat every 15 frames, landing 30 ms, a frame, after each half second. */
export const beat = 15;
const downbeat = 1;
/** The score's length, in frames. */
const scoreLength = 1800;

interface Recording {
  readonly text: string;
  readonly duration: number;
  readonly words: readonly { readonly text: string; readonly start: number; readonly end: number }[];
}

/** The trimmed takes, written by `video/voice.ts`. */
const recordings: Record<LineName, Recording> = voice.lines;

export interface Word {
  readonly text: string;
  /** The film frames the word is spoken over. */
  readonly at: number;
  readonly end: number;
}

export interface Line {
  readonly name: LineName;
  readonly text: string;
  /** The film frames the recording plays over. */
  readonly from: number;
  readonly until: number;
  readonly words: readonly Word[];
  /** The recording, under video/public. */
  readonly file: string;
}

/** The film timed to the narration: every line on a beat, the lockup after the last. */
export interface Cut {
  readonly lines: readonly Line[];
  readonly lockup: number;
  readonly durationInFrames: number;
  /** Frames of the score to skip, so its fade-out lands on the last frame and its beats stay on the grid. */
  readonly skip: number;
}

/** Seconds of quiet before a line: a breath, or longer where the film turns. */
const pauses: Partial<Record<LineName, number>> = { blocks: 0.4, harness: 1, foundation: 0.7, consistency: 0.7, rewrite: 0.7, wrong: 0.9, nyte: 1.5, machine: 0.7, own: 0.8 };
const breath = 0.3;

/** The first beat on or after `frame`. */
const onBeat = (frame: number) => Math.ceil((frame - downbeat) / beat) * beat + downbeat;

function cutFilm(): Cut {
  const lines: Line[] = [];
  for (const { name } of script) {
    const take = recordings[name];
    const previous = lines.at(-1);
    const from = onBeat((previous?.until ?? 0) + Math.round((pauses[name] ?? breath) * fps));
    lines.push({
      name,
      text: take.text,
      from,
      until: from + Math.ceil(take.duration * fps),
      words: take.words.map((word) => ({ text: word.text, at: from + Math.round(word.start * fps), end: from + Math.round(word.end * fps) })),
      file: `voice/${name}.wav`,
    });
  }
  const last = lines.at(-1);
  if (!last) throw new Error("The script has no lines");
  const lockup = onBeat(last.until + Math.round(0.6 * fps));
  const durationInFrames = lockup + lockupLength;
  return { lines, lockup, durationInFrames, skip: Math.max(0, Math.floor((scoreLength - durationInFrames) / beat) * beat) };
}

export const cut = cutFilm();

export function findLine(name: LineName) {
  const line = cut.lines.find((entry) => entry.name === name);
  if (!line) throw new Error(`The cut has no line "${name}"`);
  return line;
}

const bare = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}'-]/gu, "");

/** The spoken word whose letters are `text`, ignoring case and punctuation. */
export function findWord(line: Line, text: string) {
  const word = line.words.find((entry) => bare(entry.text) === text);
  if (!word) throw new Error(`"${line.text}" has no word "${text}"`);
  return word;
}

/** The line after this one, if there is one. */
export function nextLine(line: Line) {
  return cut.lines[cut.lines.indexOf(line) + 1];
}
