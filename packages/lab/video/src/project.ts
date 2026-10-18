import type { ComponentType } from "react";
import { Ending, layers as endingLayers, length, markers as endingMarkers } from "./film/ending";
import { Film, effects, layers as filmLayers, score } from "./film/film";
import type { Layer } from "./film/layer";
import { beats, durationInFrames, fps } from "./film/timeline";
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
    name: "Nyte · 60 s",
    component: Film,
    width: 1920,
    height: 1080,
    fps,
    durationInFrames,
    layers: filmLayers,
    markers: Object.entries(beats).map(([name, at]) => ({ name, at })),
  },
  {
    id: "ending",
    name: "Ending",
    component: Ending,
    width: 1920,
    height: 1080,
    fps,
    durationInFrames: length,
    layers: endingLayers,
    markers: endingMarkers,
    offset: { composition: "nyte", at: beats.dawn },
  },
];

const uses = new Map<string, number>();
for (const effect of effects) uses.set(effect.file, (uses.get(effect.file) ?? 0) + 1);

export const footage: readonly Footage[] = [
  { name: "score.mp3", file: score.file, kind: "audio", use: "The score, 120 BPM: a beat every 15 frames." },
  ...[...uses].map(([file, count]) => ({
    name: file.replace("sfx/", ""),
    file,
    kind: "audio" as const,
    use: `Sound effect, ${count === 1 ? "once" : `${count} times`}.`,
  })),
];

export const fonts: readonly Font[] = [
  { name: "Geist Pixel", family: font.pixel, use: "Captions, the wheel and the name." },
  { name: "Geist", family: font.sans, use: "The closing line." },
  { name: "Geist Mono", family: font.mono, use: "nyte.sh." },
  { name: "Inter", family: "'Inter Variable', sans-serif", use: "The app's own interface." },
];

export const sources: readonly Source[] = [
  { file: "video/src/film/ending.tsx", holds: "The closing shot, from dawn to the last frame." },
  { file: "video/src/film/film.tsx", holds: "The film: strip, window, camera, captions, sound." },
  { file: "video/src/film/timeline.ts", holds: "The beats every scene is cued from." },
  { file: "video/src/film/chat.ts", holds: "The session the window shows, frame by frame." },
  { file: "video/src/film/window.tsx", holds: "The app window, from the app's real parts." },
  { file: "video/src/film/dither.tsx", holds: "Dithered sky, moon and palette." },
  { file: "video/src/film/type.tsx", holds: "Kinetic type, fonts and easing." },
];
