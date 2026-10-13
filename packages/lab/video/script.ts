export interface Line {
  id: string;
  /** What the narrator says. */
  text: string;
  /**
   * How the words are on screen, the two ways the Notion film shows them: subtitles under the picture,
   * or one word at a time on black. `none` where the picture already says them.
   */
  show: "subtitles" | "words" | "none";
  /** Seconds of quiet, at least, after the line. The cue then rounds up to whole bars. */
  pause: number;
}

/** The score's tempo. At 80 BPM a bar is three seconds, and every cut lands on a downbeat. */
export const tempo = 80;

export const lines = [
  {
    id: "weekend",
    text: "This year, anyone can ship an AI app in a weekend.",
    show: "subtitles",
    pause: 0.6,
  },
  {
    id: "same",
    text: "Most of them feel the same. Close the window, and the work is gone.",
    show: "subtitles",
    pause: 0.6,
  },
  { id: "cheap", text: "Speed got cheap. Care didn't.", show: "words", pause: 1 },
  { id: "longer", text: "Nyte took longer.", show: "subtitles", pause: 1 },
  {
    id: "numbers",
    text: "Four hundred and sixty-seven commits. Fifty-eight of them in the core.",
    show: "none",
    pause: 0.6,
  },
  {
    id: "git",
    text: "Every step is saved, like a commit. Close the app, and nothing is lost.",
    show: "subtitles",
    pause: 0.6,
  },
  {
    id: "phone",
    text: "Come back tomorrow. Or check in from your phone while it works.",
    show: "subtitles",
    pause: 0.6,
  },
  {
    id: "together",
    text: "No army of agents. One person and one agent, thinking it through.",
    show: "subtitles",
    pause: 0.8,
  },
  { id: "night", text: "Good work takes more than one night.", show: "subtitles", pause: 1 },
  { id: "end", text: "Nyte. Sleep on it.", show: "none", pause: 3 },
] as const satisfies readonly Line[];

export type LineId = (typeof lines)[number]["id"];

/** Seconds of picture before the narrator's first word: the chat box types itself. */
export const leadIn = 1.5;

export interface Section {
  name: string;
  lines: readonly LineId[];
  styles: readonly string[];
  /** Holds its level to the cut instead of ending; only the drop and the resolve end on their own. */
  loop: boolean;
  /** Loudness in LUFS when the score is assembled from separate takes, so Together is the peak. */
  level: number;
}

export const score = [
  {
    name: "Day",
    lines: ["weekend", "same"],
    styles: [
      "muted felt piano ostinato in eighth notes",
      "soft wooden tick on every beat, like a clock",
      "light, clean, a little restless",
    ],
    loop: true,
    level: -22,
  },
  {
    name: "Turn",
    lines: ["cheap"],
    styles: ["everything drops away", "one sustained low piano note", "near silence, lots of air"],
    loop: false,
    level: -24,
  },
  {
    name: "Night",
    lines: ["longer", "numbers", "git", "phone"],
    styles: [
      "warm analog pads enter",
      "soft low pulse on every beat",
      "slow patient build",
      "calm and deep",
    ],
    loop: true,
    level: -20,
  },
  {
    name: "Together",
    lines: ["together", "night"],
    styles: [
      "the fullest moment of the piece",
      "gentle swell",
      "simple piano melody returns over the pads",
      "hopeful",
    ],
    loop: true,
    level: -17,
  },
  {
    name: "Resolve",
    lines: ["end"],
    styles: ["quiet resolve", "a final sustained chord rings out", "fades to silence"],
    loop: false,
    level: -21,
  },
] as const satisfies readonly Section[];
