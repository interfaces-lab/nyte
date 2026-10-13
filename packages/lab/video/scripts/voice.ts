import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { lines } from "../script.ts";
import type { Manifest, Word } from "../src/manifest.ts";

const voiceDir = join(import.meta.dirname, "../public/voice");

const manifestPath = join(voiceDir, "manifest.json");

const key = process.env.ELEVENLABS_API_KEY;

if (!key) throw new Error("Set ELEVENLABS_API_KEY.");

// Brian: a low, unhurried narrator, close to the Notion read.
const voice = process.env.ELEVENLABS_VOICE_ID ?? "nPczCjzI2devNBz1zQrb";

const model = process.env.ELEVENLABS_MODEL_ID ?? "eleven_multilingual_v2";

const Speech = Type.Object({
  audio_base64: Type.String(),
  alignment: Type.Object({
    characters: Type.Array(Type.String()),
    character_start_times_seconds: Type.Array(Type.Number()),
    character_end_times_seconds: Type.Array(Type.Number()),
  }),
});

const words = (alignment: {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}) => {
  const result: Word[] = [];
  let current: Word | undefined;
  alignment.characters.forEach((character, index) => {
    if (character.trim() === "") {
      current = undefined;

      return;
    }

    const start = alignment.character_start_times_seconds[index] ?? 0;
    const end = alignment.character_end_times_seconds[index] ?? start;

    if (current) {
      current.text += character;
      current.end = end;

      return;
    }

    current = { text: character, start, end };
    result.push(current);
  });

  return result;
};

const duration = (file: string) =>
  Number(
    execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
      { encoding: "utf8" },
    ),
  );

mkdirSync(voiceDir, { recursive: true });

const manifest: Manifest = { voice, model, lines: [] };

for (const [index, line] of lines.entries()) {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        text: line.text,
        model_id: model,
        previous_text: lines[index - 1]?.text,
        next_text: lines[index + 1]?.text,
        voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.15, speed: 0.92 },
      }),
    },
  );

  if (!response.ok) throw new Error(`${line.id}: ${response.status} ${await response.text()}`);
  const body: unknown = await response.json();

  if (!Value.Check(Speech, body)) throw new Error(`${line.id}: unexpected response`);
  const file = `${line.id}.mp3`;
  const path = join(voiceDir, file);
  writeFileSync(path, Buffer.from(body.audio_base64, "base64"));
  manifest.lines.push({
    id: line.id,
    text: line.text,
    file: `voice/${file}`,
    duration: duration(path),
    words: words(body.alignment),
  });
  console.log(`${line.id}  ${manifest.lines.at(-1)?.duration.toFixed(2)}s`);
}

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
