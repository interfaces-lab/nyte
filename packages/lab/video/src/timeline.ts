import { leadIn, lines, tempo, type Line, type LineId } from "../script.ts";
import type { Manifest, Word } from "./manifest";

export const fps = 30;

/** Frames in a bar of four beats. */
export const bar = (60 / tempo) * 4 * fps;

/** Narration pace for lines without a recording, close to the ElevenLabs read. */
const wordsPerSecond = 2.4;

export interface Cue {
  id: LineId;
  text: string;
  show: Line["show"];
  /** First frame of the line in the film. */
  from: number;
  /** Whole bars, from the line's start until the next line starts. */
  length: number;
  audio: string | undefined;
  /** Frame within the cue where the voice starts. Only the first cue waits, for the lead-in. */
  voiceAt: number;
  /** Word times in seconds from the cue's start. */
  words: Word[];
}

const estimate = (text: string) =>
  text.split(" ").map((text, index) => ({
    text,
    start: index / wordsPerSecond,
    end: (index + 1) / wordsPerSecond,
  }));

export const timeline = (manifest: Manifest | null) => {
  let cursor = 0;

  const cues = lines.map((line, index): Cue => {
    const wait = index === 0 ? leadIn : 0;

    // A recording made from older wording would drift from the script, so it is ignored.
    const recorded = manifest?.lines.find(
      (entry) => entry.id === line.id && entry.text === line.text,
    );

    const words = recorded?.words ?? estimate(line.text);
    const spoken = recorded?.duration ?? (words.at(-1)?.end ?? 0) + 0.2;

    const cue = {
      id: line.id,
      text: line.text,
      show: line.show,
      from: cursor,
      length: Math.ceil(((wait + spoken + line.pause) * fps) / bar) * bar,
      audio: recorded?.file,
      voiceAt: Math.round(wait * fps),
      words: words.map((word) => ({ ...word, start: word.start + wait, end: word.end + wait })),
    };

    cursor += cue.length;

    return cue;
  });

  return { cues, duration: cursor };
};

/** Local frame at which the first word starting with `prefix` begins. */
export const at = (cue: Cue, prefix: string) => {
  const word = cue.words.find((word) => word.text.toLowerCase().startsWith(prefix.toLowerCase()));

  return Math.round((word?.start ?? 0) * fps);
};
