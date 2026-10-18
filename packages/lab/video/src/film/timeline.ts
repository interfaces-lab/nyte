export const fps = 30;
export const durationInFrames = 60 * fps;

/** The score runs at 120 BPM: a beat every 15 frames. */
export const beat = 15;

export const beats = {
  /** The macro strip of the app's parts. */
  strip: 0,
  /** The composer comes up close and the prompt is typed. */
  composer: 150,
  typing: 165,
  send: 255,
  /** Pulled back with the first caption. */
  hand: 345,
  quitKey: 470,
  away: 480,
  reopen: 570,
  /** The camera finds the prompt to edit it. */
  branchFocus: 720,
  editStart: 780,
  pick: 870,
  branchSend: 905,
  branch: 910,
  ask: 1010,
  select: 1150,
  answer: 1180,
  pull: 1250,
  dawn: 1505,
  end: 1560,
} as const;
