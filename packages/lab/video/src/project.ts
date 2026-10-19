import type { ComponentType } from "react";
import { cut, fps } from "./film/cut";
import { Ending, layers as endingLayers, length as endingLength, markers as endingMarkers } from "./film/ending";
import { Film, layers as filmLayers, score } from "./film/film";
import type { Layer } from "./film/layer";
import { narrator } from "./film/script";
import { font } from "./film/type";

export type { Layer };

export interface Marker {
  readonly name: string;
  readonly at: number;
}

export interface Composition {
  readonly id: string;
  readonly name: string;
  readonly component: ComponentType;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly durationInFrames: number;
  readonly layers: readonly Layer[];
  readonly markers: readonly Marker[];
  /** Where this composition sits in the film, when it is a precomp of it. */
  readonly offset?: { readonly composition: string; readonly at: number };
}

export interface Footage {
  readonly name: string;
  /** Under video/public; Remotion reads it with staticFile, the studio from /video/. */
  readonly file: string;
  readonly kind: "audio";
  readonly use: string;
}

export interface Font {
  readonly name: string;
  readonly family: string;
  readonly use: string;
}

export interface Source {
  readonly file: string;
  readonly holds: string;
}

/** Everything the film is made of: what the Remotion CLI renders and the lab's studio shows. */
export const compositions: readonly Composition[] = [
  {
    id: "nyte",
    name: `Nyte · ${narrator.name} · ${Math.round(cut.durationInFrames / fps)} s`,
    component: Film,
    width: 1920,
    height: 1080,
    fps,
    durationInFrames: cut.durationInFrames,
    layers: filmLayers,
    markers: [...cut.lines.map((line) => ({ name: line.name, at: line.from })), { name: "lockup", at: cut.lockup }],
  },
  {
    id: "ending",
    name: "Ending",
    component: Ending,
    width: 1920,
    height: 1080,
    fps,
    durationInFrames: endingLength,
    layers: endingLayers,
    markers: endingMarkers,
    offset: { composition: "nyte", at: cut.lockup },
  },
];

export const footage: readonly Footage[] = [
  { name: "score.mp3", file: score.file, kind: "audio", use: "The score, generated with ElevenLabs Music in five sections that follow the film: blocks, pressure, the turn, the foundation and the resolve. 120 BPM, a beat every 15 frames; it plays under the whole film and rings out on the lockup." },
  ...cut.lines.map((line) => ({ name: `${line.name}.wav`, file: line.file, kind: "audio" as const, use: `${narrator.name}: "${line.text}"` })),
];

export const fonts: readonly Font[] = [
  { name: "Geist", family: font.sans, use: "Every word on screen: captions, statements, headlines, the sentence, the name and nyte.sh." },
];

export const sources: readonly Source[] = [
  { file: "video/src/film/script.ts", holds: "The narration, line by line, and its narrator." },
  { file: "video/voice.ts", holds: "Records the narration with ElevenLabs and trims each take clean." },
  { file: "video/src/film/cut.ts", holds: "The film timed to the narration: every line on a beat." },
  { file: "video/src/film/film.tsx", holds: "The film: pictures, narration, voice and score." },
  { file: "video/src/film/scenes.tsx", holds: "The gameplay, the photographs and the product, each cut on the words that drive it." },
  { file: "video/src/film/media.ts", holds: "The gameplay, photographs and app footage, with their sources and credits." },
  { file: "video/src/film/frame.tsx", holds: "A region of a picture or a take, covering a box." },
  { file: "video/src/film/words.tsx", holds: "The narration as text: captions, statements, headlines and the sentence." },
  { file: "video/src/film/ending.tsx", holds: "The closing flicker and lockup." },
  { file: "video/src/film/dither.tsx", holds: "Dithered dissolves, moon and palette." },
  { file: "video/src/film/type.tsx", holds: "Kinetic type, fonts and easing." },
  { file: "video/src/snap-cn/logo-flicker.tsx", holds: "snapcn's Logo Flicker, cutting the film's pictures on the beat." },
  { file: "video/src/snap-cn/check-cycle.tsx", holds: "snapcn's Check Cycle: \"Your ☑ …\", rolling as the narrator speaks." },
];
