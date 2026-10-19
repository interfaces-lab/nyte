/**
 * The narration, one recording per line. `video/voice.ts` records and trims
 * each line; the film cuts its picture to the recordings.
 *
 * It opens the way Notion's "Think together" does: a real clip first, then
 * the thesis, then the problem, then "We think…", then the answer.
 */
export const script = [
  { name: "blocks", text: "We all started with blocks." },
  { name: "stacked", text: "Stacked them up, took them apart," },
  { name: "world", text: "and built worlds that were ours." },
  { name: "beneath", text: "Every block stood on the one beneath it." },
  { name: "harness", text: "In the age of AI, everyone wants to build their own harness." },
  { name: "factory", text: "Billion-dollar companies with whole teams trying to build a software factory." },
  { name: "foundation", text: "No need for a foundation." },
  { name: "consistency", text: "No need for consistency." },
  { name: "rewrite", text: "And AI will rewrite them all." },
  { name: "wrong", text: "We think that's the wrong direction." },
  { name: "nyte", text: "Nyte is the foundation." },
  { name: "parts", text: "Your skills. Your subagents. Your MCP servers. Your canvases. Your models." },
  { name: "top", text: "Build any harness on top." },
  { name: "machine", text: "It runs on your machine." },
  { name: "open", text: "It's open source." },
  { name: "own", text: "Build your own." },
] as const;

export type LineName = (typeof script)[number]["name"];

/** The narrator: Sarah, one of ElevenLabs' premade voices, read by its Eleven v4 model. */
export const narrator = { name: "Sarah", voice: "EXAVITQu4vr4xnSDxMaL", model: "eleven_v4" } as const;
