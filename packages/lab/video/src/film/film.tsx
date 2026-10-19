import { Audio } from "@remotion/media";
import { AbsoluteFill, Sequence, interpolate, staticFile } from "remotion";
import { cut, findLine, nextLine } from "./cut";
import { palette } from "./dither";
import { Ending } from "./ending";
import type { Layer } from "./layer";
import { clip } from "./media";
import { Clip, Photographs, Product } from "./scenes";
import type { LineName } from "./script";
import { Narration } from "./words";

const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export const score = { file: "music/score.mp3", volume: 0.37 } as const;

/** The score: in over the first half second, ducked under the voice, playing through to the last frame. */
function musicVolume(frame: number) {
  const speaking = Math.max(0, ...cut.lines.map((line) => interpolate(frame, [line.from - 4, line.from + 2, line.until, line.until + 8], [0, 1, 1, 0], CLAMP)));
  return score.volume * interpolate(frame, [0, 15], [0, 1], CLAMP) * (1 - 0.5 * speaking);
}

export function Film() {
  return (
    <AbsoluteFill style={{ background: palette.ink, overflow: "hidden" }}>
      <Clip />
      <Photographs />
      <Product />
      <Narration />
      <Sequence from={cut.lockup}>
        <Ending />
      </Sequence>
      <Audio src={staticFile(score.file)} trimBefore={cut.skip} volume={musicVolume} />
      {cut.lines.map((line) => (
        <Sequence key={line.name} from={line.from}>
          <Audio src={staticFile(line.file)} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}

const at = (name: LineName) => findLine(name).from;

/** The film's layers, front to back, for the studio's timeline. Keep each span true to when the layer draws. */
export const layers: readonly Layer[] = [
  ...cut.lines.map((line): Layer => ({ name: line.text, kind: "text", from: line.from, until: nextLine(line)?.from ?? cut.lockup })),
  { name: "The app, filmed in a sandbox, tilted under the headlines", kind: "ui", from: at("nyte"), until: at("own") },
  { name: "Photographs, cut on the phrases", kind: "ui", from: at("harness"), until: at("wrong") },
  { name: `Clip: ${clip.file}, ${clip.credit}`, kind: "ui", from: 0, until: at("beneath") },
  { name: "Ending", kind: "precomp", from: cut.lockup, until: cut.durationInFrames, composition: "ending" },
  ...cut.lines.map((line): Layer => ({ name: `${line.name}.wav`, kind: "audio", from: line.from, until: line.until, file: line.file })),
  { name: "score.mp3", kind: "audio", from: 0, until: cut.durationInFrames, file: score.file },
];
