/**
 * Records the film's narration with ElevenLabs and trims each take clean.
 *
 *   ELEVENLABS_API_KEY=… node video/voice.ts record [line,…]   # takes into video/out/voice/, every line unless named
 *   node video/voice.ts trim                                  # public/voice/*.wav and src/film/voice.json
 *
 * Trimming cuts on the waveform, anchored on ElevenLabs' character timings:
 * the take starts at the first word's onset, so an inhale before it goes; it
 * ends where the last word's sound runs out, at the first pause after the word
 * starts or the first silence after its timing ends, so a breath, click or
 * artifact after it goes; pauses between phrases are gated, so breaths inside them go. Every
 * line of one narrator gets the same gain, levelling speech without flattening
 * it, and a look-ahead limiter keeps the peaks that gain lifts under -1.5 dBFS.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { narrator, script } from "./src/film/script.ts";
import type { LineName } from "./src/film/script.ts";

const RATE = 44_100;
/** Analysis windows of 5 ms. */
const STEP = 220;
/** Vowels and voiced consonants sit above this level, in dBFS; silence sits below the floor. */
const VOICED = -30;
const SILENT = -52;
/** Five silent windows, 25 ms, end a run of sound. */
const GAP = 5;
/** Thirty silent windows, 150 ms, are a pause, longer than any stop inside a word. */
const PAUSE = 30;
/** Speech is levelled to this RMS, in dBFS; peaks are limited to the ceiling, -1.5 dBFS. */
const SPEECH = -18;
const CEILING = 0.84 * 32768;

const letter = /[\p{L}\p{N}]/u;
const round = (value: number) => Math.round(value * 1000) / 1000;

interface Alignment {
  readonly characters: readonly string[];
  readonly starts: readonly number[];
  readonly ends: readonly number[];
}

const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");
const isNumbers = (value: unknown): value is number[] => Array.isArray(value) && value.every((item) => typeof item === "number");

function readAlignment(value: unknown): Alignment {
  if (typeof value !== "object" || value === null || !("characters" in value) || !("character_start_times_seconds" in value) || !("character_end_times_seconds" in value)) {
    throw new Error(`Not an ElevenLabs alignment: ${JSON.stringify(value)}`);
  }
  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } = value;
  if (!isStrings(characters) || !isNumbers(starts) || !isNumbers(ends)) throw new Error("An ElevenLabs alignment holds characters and their times");
  return { characters, starts, ends };
}

async function record(takes: string, only: ReadonlySet<string>) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("Set ELEVENLABS_API_KEY to record");
  mkdirSync(takes, { recursive: true });

  for (const [index, line] of script.entries()) {
    if (only.size > 0 && !only.has(line.name)) continue;
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${narrator.voice}/with-timestamps?output_format=mp3_44100_192`, {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: line.text,
        model_id: narrator.model,
        previous_text: script.slice(Math.max(0, index - 2), index).map((item) => item.text).join(" "),
        next_text: script.slice(index + 1, index + 3).map((item) => item.text).join(" "),
        voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0.12, use_speaker_boost: true, speed: 0.95 },
        seed: 7,
      }),
    });
    const body: unknown = await response.json();
    if (!response.ok || typeof body !== "object" || body === null || !("audio_base64" in body) || typeof body.audio_base64 !== "string" || !("alignment" in body)) {
      throw new Error(`ElevenLabs refused "${line.text}": ${JSON.stringify(body)}`);
    }
    readAlignment(body.alignment);
    writeFileSync(join(takes, `${line.name}.mp3`), Buffer.from(body.audio_base64, "base64"));
    writeFileSync(join(takes, `${line.name}.json`), JSON.stringify(body.alignment));
    console.log(`${line.name}: recorded`);
  }
}

function decode(file: string) {
  const pcm = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", String(RATE), "-f", "s16le", "pipe:1"], { maxBuffer: 1 << 28 });
  const samples = new Float64Array(pcm.length / 2);
  for (let index = 0; index < samples.length; index++) samples[index] = pcm.readInt16LE(index * 2);
  return samples;
}

/** The level of each 5 ms window, in dBFS. */
function envelope(samples: Float64Array) {
  const levels: number[] = [];
  for (let start = 0; start < samples.length; start += STEP) {
    const end = Math.min(samples.length, start + STEP);
    let power = 0;
    for (let index = start; index < end; index++) power += (samples[index] ?? 0) ** 2;
    levels.push(20 * Math.log10(Math.max(Math.sqrt(power / (end - start)) / 32768, 1e-9)));
  }
  return levels;
}

/** Scales samples from `start` to `end` by a gain easing from `from` to `to`. */
function ramp(samples: Float64Array, start: number, end: number, from: number, to: number) {
  const span = Math.max(1, end - start);
  for (let index = Math.max(0, start); index < Math.min(end, samples.length); index++) {
    const eased = 0.5 - 0.5 * Math.cos((Math.PI * (index - start)) / span);
    samples[index] = (samples[index] ?? 0) * (from + (to - from) * eased);
  }
}

interface Word {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

function trimTake(takes: string, name: LineName) {
  const samples = decode(join(takes, `${name}.mp3`));
  const { characters, starts, ends } = readAlignment(JSON.parse(readFileSync(join(takes, `${name}.json`), "utf8")));
  const letters = characters.flatMap((character, index) => (letter.test(character) ? [index] : []));
  const firstLetter = letters[0];
  const lastLetter = letters.at(-1);
  if (firstLetter === undefined || lastLetter === undefined) throw new Error(`The take of ${name} has no words`);

  const level = envelope(samples);
  const windowAt = (seconds: number) => Math.max(0, Math.min(level.length - 1, Math.trunc((seconds * RATE) / STEP)));
  const voiced = (window: number) => (level[window] ?? -180) > VOICED;
  const silent = (window: number) => (level[window] ?? -180) < SILENT;
  const startOf = (index: number) => starts[index] ?? 0;
  const endOf = (index: number) => ends[index] ?? 0;

  let onset = windowAt(startOf(firstLetter));
  for (let window = windowAt(startOf(firstLetter) - 0.1); window < windowAt(startOf(firstLetter) + 0.35); window++) {
    if (!voiced(window)) continue;
    onset = window;
    break;
  }
  let begin = onset;
  let quiet = 0;
  while (begin > 0 && onset - begin < 36) {
    if (silent(begin - 1)) {
      quiet++;
      if (quiet >= GAP) {
        begin += GAP - 1;
        break;
      }
    } else quiet = 0;
    begin--;
  }

  const lastSpace = characters.findLastIndex((character, index) => index < lastLetter && character.trim() === "");
  const lastWord = letters.find((index) => index > lastSpace) ?? lastLetter;
  const aligned = windowAt(endOf(lastLetter) + 0.03);
  let finish = windowAt(startOf(lastWord));
  quiet = 0;
  for (let window = finish; window < level.length; window++) {
    if (!silent(window)) {
      quiet = 0;
      finish = window + 1;
    } else if (++quiet >= (window > aligned ? GAP : PAUSE)) break;
  }

  const first = Math.max(0, begin * STEP - Math.trunc(0.01 * RATE));
  const clip = samples.slice(first, Math.min(samples.length, finish * STEP + Math.trunc(0.025 * RATE)));

  const edge = Math.trunc(0.01 * RATE);
  for (const [position, before] of letters.entries()) {
    const after = letters[position + 1];
    if (after === undefined || after - before <= 1 || startOf(after) - endOf(before) <= 0.15) continue;
    const lo = Math.trunc((endOf(before) + 0.04) * RATE) - first;
    const hi = Math.trunc((startOf(after) - 0.04) * RATE) - first;
    if (hi - lo <= Math.trunc(0.05 * RATE)) continue;
    if (Math.max(-180, ...level.slice(windowAt((lo + first) / RATE), windowAt((hi + first) / RATE) + 1)) >= VOICED) continue;
    ramp(clip, lo, lo + edge, 1, 0.02);
    for (let index = Math.max(0, lo + edge); index < Math.min(clip.length, hi - edge); index++) clip[index] = (clip[index] ?? 0) * 0.02;
    ramp(clip, hi - edge, hi, 0.02, 1);
  }
  ramp(clip, 0, edge, 0, 1);
  ramp(clip, clip.length - Math.trunc(0.045 * RATE), clip.length, 1, 0);

  const offset = first / RATE;
  const words: Word[] = [];
  let word: { text: string; start: number; end: number } | undefined;
  for (const [index, character] of characters.entries()) {
    if (character.trim() === "") {
      if (word) words.push(word);
      word = undefined;
      continue;
    }
    word ??= { text: "", start: round(Math.max(0, startOf(index) - offset)), end: 0 };
    word.text += character;
    if (letter.test(character)) word.end = round(endOf(index) - offset);
  }
  if (word) words.push(word);

  return { clip, words };
}

/** One gain for all of a narrator's lines: what brings their speech, the windows above -40 dBFS, to `SPEECH`. */
function levelling(clips: readonly Float64Array[]) {
  let power = 0;
  let windows = 0;
  for (const clip of clips) {
    for (let start = 0; start < clip.length; start += STEP) {
      const end = Math.min(clip.length, start + STEP);
      let sum = 0;
      for (let index = start; index < end; index++) sum += ((clip[index] ?? 0) / 32768) ** 2;
      if (10 * Math.log10(Math.max(sum / (end - start), 1e-18)) < -40) continue;
      power += sum / (end - start);
      windows++;
    }
  }
  return 10 ** ((SPEECH - 10 * Math.log10(power / Math.max(windows, 1))) / 20);
}

/** The clip raised by `gain`, its peaks held under `CEILING` by a limiter that looks 5 ms ahead and lets go over 80 ms. */
function limit(clip: Float64Array, gain: number) {
  const ahead = 220;
  const attack = 1 - Math.exp(-1 / (0.0015 * RATE));
  const release = 1 - Math.exp(-1 / (0.08 * RATE));
  const needed = clip.map((sample) => Math.min(1, CEILING / Math.max(Math.abs(sample * gain), 1e-9)));
  const limited = new Float64Array(clip.length);
  let current = 1;
  for (let index = 0; index < clip.length; index++) {
    let lowest = 1;
    for (let next = index; next < Math.min(clip.length, index + ahead); next++) lowest = Math.min(lowest, needed[next] ?? 1);
    current += (lowest - current) * (lowest < current ? attack : release);
    limited[index] = (clip[index] ?? 0) * gain * current;
  }
  return limited;
}

function writeWav(file: string, samples: Float64Array) {
  const data = Buffer.alloc(samples.length * 2);
  for (const [index, sample] of samples.entries()) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.trunc(sample))), index * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(file, Buffer.concat([header, data]));
}

function trim(takes: string) {
  const trimmed = script.map((line) => ({ line, ...trimTake(takes, line.name) }));
  const gain = levelling(trimmed.map((take) => take.clip));
  const audio = join(import.meta.dirname, "public/voice");
  mkdirSync(audio, { recursive: true });

  for (const take of trimmed) writeWav(join(audio, `${take.line.name}.wav`), limit(take.clip, gain));
  const lines = Object.fromEntries(trimmed.map((take) => [take.line.name, { text: take.line.text, duration: round(take.clip.length / RATE), words: take.words }]));
  writeFileSync(join(import.meta.dirname, "src/film/voice.json"), `${JSON.stringify({ narrator: narrator.name, lines }, null, 1)}\n`);

  for (const take of trimmed) console.log(`${take.line.name.padEnd(12)} ${(take.clip.length / RATE).toFixed(2)} s  ${take.line.text}`);
  console.log(`gain ${(20 * Math.log10(gain)).toFixed(1)} dB`);
}

const [command, names = ""] = process.argv.slice(2);
if (command !== "record" && command !== "trim") {
  console.error("Usage: node video/voice.ts record [line,…] | trim");
  process.exit(1);
}

const takes = join(import.meta.dirname, "out/voice");
if (command === "record") await record(takes, new Set(names.split(",").filter(Boolean)));
trim(takes);
