import { AbsoluteFill, useCurrentFrame } from "remotion";
import { LogoFlicker } from "../snap-cn/logo-flicker";
import { Moon, ditherStyle, palette } from "./dither";
import { Frame } from "./frame";
import type { Layer } from "./layer";
import { app, photos } from "./media";
import { font, progress } from "./type";

/** The closing shot's length: the flicker, then the lockup held for two and a half seconds. */
export const length = 180;

/** The shots cut in on the score's eighth notes, then its quarter notes, from the beat the shot starts on. */
export const cuts = [0, 8, 15, 23, 30, 38, 45, 53, 60, 75];
/** The frames the last shot dissolves into the lockup over. */
export const fade = [90, 105] as const;

/** The film's pictures flip past full-frame, the archive first and the product last. */
const shots = [photos.masons, photos.harness, photos.teams, photos.computers, photos.factory, photos.foundation, photos.consistency, photos.rewrite, app.canvas, app.desktop].map((media) => (
  <Frame key={media.file} media={media} width={1920} height={1080} />
));

/** The shot's layers, front to back, for the studio's timeline. Keep each span true to when the layer draws. */
export const layers: readonly Layer[] = [
  { name: "nyte.sh", kind: "text", from: fade[1] + 30, until: length },
  { name: "Build your own.", kind: "text", from: fade[1] + 12, until: length },
  { name: "Moon and name", kind: "shape", from: fade[0], until: length },
  { name: "The film's pictures, flipping on the beat", kind: "ui", from: 0, until: fade[1] },
];

/** Named moments, drawn on the ruler. */
export const markers = [
  { name: "flicker", at: 0 },
  { name: "quarters", at: cuts[6] ?? 45 },
  { name: "fade", at: fade[0] },
  { name: "line", at: fade[1] + 12 },
  { name: "url", at: fade[1] + 30 },
] as const;

/** The full moon beside the name. */
function Lockup() {
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 34, marginTop: -110 }}>
        <div style={{ position: "relative", width: 112, height: 112 }}>
          <div style={{ position: "absolute", left: 56 - 198, top: 56 - 198, transform: "scale(0.28)", filter: "drop-shadow(0 0 14px rgb(190 205 255 / 0.4))" }}>
            <Moon cells={44} pixel={9} phase={0.1} earthshine={0.26} gap={false} />
          </div>
        </div>
        <div style={{ fontFamily: font.sans, fontSize: 132, fontWeight: 600, lineHeight: 1, color: palette.white, letterSpacing: "-0.04em" }}>Nyte</div>
      </div>
    </AbsoluteFill>
  );
}

/** The film's pictures flip past and slow down on the beat, then resolve into the moon, the name, the line and the address. */
export function Ending() {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ background: palette.ink }}>
      <LogoFlicker shots={shots} cuts={cuts} fade={fade} dissolve={(shown) => ditherStyle(shown, 4)}>
        <Lockup />
      </LogoFlicker>
      <div style={{ position: "absolute", left: 0, right: 0, top: 600, textAlign: "center", fontFamily: font.sans, fontSize: 44, fontWeight: 500, letterSpacing: "-0.02em", color: palette.haze, ...ditherStyle(progress(frame, fade[1] + 12, 10), 2) }}>
        Build your own.
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 84, textAlign: "center", fontFamily: font.sans, fontSize: 30, fontWeight: 500, letterSpacing: "-0.01em", color: "rgb(170 180 255 / 0.7)", ...ditherStyle(progress(frame, fade[1] + 30, 10), 2) }}>
        nyte.sh
      </div>
    </AbsoluteFill>
  );
}
