import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import type { Layer } from "./layer";
import { Field, Moon, ditherStyle, palette, rgb } from "./dither";
import { Words, ease, font, progress, sentence } from "./type";

/** The shot runs from the film's dawn beat to its last frame. */
export const length = 295;

/** Where the night moon leaves for the centre and the name comes up. */
const card = 55;

/** The shot's layers, front to back, for the studio's timeline. Keep each span true to when the layer draws. */
export const layers: readonly Layer[] = [
  { name: "nyte.sh", kind: "text", from: card + 120, until: length },
  { name: "Every session outlives…", kind: "text", from: card + 50, until: length },
  { name: "Nyte", kind: "text", from: card + 24, until: length },
  { name: "Moon", kind: "shape", from: 0, until: length },
  { name: "Dawn sky", kind: "shape", from: 0, until: length },
];

/** Named moments, drawn on the ruler. */
export const markers = [
  { name: "dawn", at: 0 },
  { name: "moonset", at: 80 },
  { name: "card", at: card },
  { name: "name", at: card + 24 },
  { name: "line", at: card + 50 },
  { name: "url", at: card + 120 },
] as const;

const sky = [palette.ink, palette.dusk, palette.top, palette.blue, palette.lift, palette.haze].map(rgb);

/** The night sky, under the moon at the top right. */
export function night(x: number, y: number) {
  return y * 0.3 + Math.max(0, 0.12 - Math.hypot(x - 0.88, y - 0.14)) * 0.6;
}

/** Night gives way to the landing plate's ramp, climbing from the horizon. */
function Sky() {
  const frame = useCurrentFrame();
  const morning = progress(frame, 0, card + 40, ease);

  return (
    <Field
      width={1920}
      height={1080}
      cell={8}
      stops={sky}
      gap={0.18}
      value={(x, y) => {
        const dark = night(x, y);
        const rise = Math.min(Math.max(morning * 1.7 - (1 - y) * 0.7, 0), 1);
        return dark + (0.4 + y * 0.6 - dark) * rise;
      }}
    />
  );
}

/** The night moon sets at the right, then rises full in the centre above the name. */
function Mark() {
  const frame = useCurrentFrame();
  const rise = progress(frame, card, 36, ease);
  const set = progress(frame, 0, 80, ease) * (1 - rise);
  const x = interpolate(rise, [0, 1], [1690, 960]);
  const y = interpolate(rise, [0, 1], [150 + set * 1000, 300]);
  const scale = interpolate(rise, [0, 1], [0.3, 0.46]);

  return (
    <div
      style={{
        position: "absolute",
        left: x - 198,
        top: y - 198,
        transform: `scale(${scale})`,
        filter: "drop-shadow(0 0 16px rgb(190 205 255 / 0.35))",
      }}
    >
      <Moon cells={44} pixel={9} phase={frame >= card ? 0.75 : 0.1} earthshine={0.26} gap={false} />
    </div>
  );
}

export function Ending() {
  const frame = useCurrentFrame();
  const line = "Every session outlives the process that started it.";

  return (
    <AbsoluteFill style={{ background: palette.ink, overflow: "hidden" }}>
      <Sky />
      <Mark />
      {frame >= card && (
        <>
          <div style={{ position: "absolute", left: 0, right: 0, top: 430, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <Words size={220} align="center" words={[{ text: "Nyte", from: card + 24 }]} />
            <div style={{ marginTop: 52 }}>
              <Words
                size={50}
                family={font.sans}
                weight={500}
                tracking="-0.025em"
                color="rgb(246 246 255 / 0.9)"
                words={sentence(line, line.split(" ").map((_, index) => card + 50 + index * 5))}
              />
            </div>
          </div>
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 84,
              textAlign: "center",
              fontFamily: font.mono,
              fontSize: 30,
              color: palette.plateInk,
              ...ditherStyle(progress(frame, card + 120, 10), 2),
            }}
          >
            nyte.sh
          </div>
        </>
      )}
    </AbsoluteFill>
  );
}
