import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Value } from "typebox/value";
import { score, tempo } from "../script.ts";
import { Manifest } from "../src/manifest.ts";
import { fps, timeline } from "../src/timeline.ts";

const api = "https://api.elevenlabs.io/v1";

const musicDir = join(import.meta.dirname, "../public/music");

const scorePath = join(musicDir, "score.mp3");

/** Each act's take from the sound model, kept so `--mix` can rebalance without generating again. */
const take = (index: number) => join(musicDir, "takes", `${index}.mp3`);

const manifestPath = join(import.meta.dirname, "../public/voice/manifest.json");

const parsed: unknown = existsSync(manifestPath)
  ? JSON.parse(readFileSync(manifestPath, "utf8"))
  : null;

// The voice decides how many bars each line holds, so record it first and the score follows its cuts.
const { cues } = timeline(Value.Check(Manifest, parsed) ? parsed : null);

const sections = score.map((section) => ({
  ...section,
  seconds: cues
    .filter((cue) => section.lines.some((id) => id === cue.id))
    .reduce((total, cue) => total + cue.length / fps, 0),
}));

const style = [
  "instrumental score for a late-night product film",
  `${tempo} BPM`,
  "4/4 time",
  "felt piano",
  "warm analog synth pads",
  "minimal, patient, lots of space",
];

const post = (path: string, body: string) => {
  const key = process.env.ELEVENLABS_API_KEY;

  if (!key) throw new Error("Set ELEVENLABS_API_KEY.");

  return fetch(`${api}${path}`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json" },
    body,
  });
};

const audio = async (response: Response) => {
  if (!response.ok) throw new Error(`${response.url}: ${response.status} ${await response.text()}`);

  return Buffer.from(await response.arrayBuffer());
};

/** The Music API composes one piece with a section per act, held to their durations. Paid plans only. */
const compose = () =>
  post(
    "/music?output_format=mp3_44100_128",
    JSON.stringify({
      model_id: "music_v1",
      respect_sections_durations: true,
      composition_plan: {
        positive_global_styles: [...style, "clean modern production"],
        negative_global_styles: ["vocals", "voice", "choir", "humming", "spoken word", "lyrics"],
        sections: sections.map((section) => ({
          section_name: section.name,
          positive_local_styles: [...section.styles],
          negative_local_styles: [],
          duration_ms: section.seconds * 1000,
          lines: [],
        })),
      },
    }),
  );

/** Without the Music API, each act comes from the sound model, one request at a time for the free plan's limit. */
const generate = async () => {
  mkdirSync(join(musicDir, "takes"), { recursive: true });

  for (const [index, section] of sections.entries()) {
    const response = await post(
      "/sound-generation?output_format=mp3_44100_128",
      JSON.stringify({
        model_id: "eleven_text_to_sound_v2",
        text: [...style, ...section.styles, "no vocals"].join(", "),
        duration_seconds: section.seconds,
        prompt_influence: 0.6,
        loop: section.loop,
      }),
    );

    writeFileSync(take(index), await audio(response));
  }
};

/** Integrated loudness in LUFS, from ffmpeg's EBU R128 summary. */
const loudness = (file: string) => {
  const { stderr } = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128", "-f", "null", "-"],
    {
      encoding: "utf8",
    },
  );

  const value = stderr
    .match(/I:\s+(-?[\d.]+) LUFS/g)
    ?.at(-1)
    ?.match(/-?[\d.]+/)?.[0];

  if (!value) throw new Error(`${file}: no loudness reading`);

  return Number(value);
};

/** Takes are levelled to their act's loudness and joined at the cuts; a few milliseconds of fade keeps a seam from clicking. */
const mix = () => {
  const files = sections.map((_, index) => take(index));

  const filters = sections.map(
    (section, index) =>
      `[${index}]atrim=0:${section.seconds},volume=${(section.level - loudness(take(index))).toFixed(2)}dB,` +
      `afade=t=in:d=0.01,afade=t=out:st=${section.seconds - 0.03}:d=0.03[a${index}]`,
  );

  const inputs = sections.map((_, index) => `[a${index}]`).join("");

  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    ...files.flatMap((file) => ["-i", file]),
    "-filter_complex",
    `${filters.join(";")};${inputs}concat=n=${sections.length}:v=0:a=1,alimiter=limit=0.9:level=0`,
    "-b:a",
    "192k",
    scorePath,
  ]);
};

mkdirSync(musicDir, { recursive: true });

if (process.argv.includes("--mix")) mix();
else {
  const composed = await compose();

  if (composed.status === 402) {
    console.log("The Music API needs a paid plan; assembling the score from the sound model.");
    await generate();
    mix();
  } else writeFileSync(scorePath, await audio(composed));
}

for (const section of sections)
  console.log(`${section.name.padEnd(9)}${section.seconds.toFixed(1)}s`);
