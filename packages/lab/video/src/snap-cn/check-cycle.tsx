import type { CSSProperties, ReactNode } from "react";
import { useId } from "react";
import { AbsoluteFill, Easing, useCurrentFrame, useVideoConfig } from "remotion";

/**
 * Check Cycle, adapted from snapcn (snapcndev/snapcn@47ee435, MIT; see
 * THIRD-PARTY-NOTICES.md). A sentence that finishes itself over and over: the
 * word beside a ticked checkbox rolls up out of a slot, one word after another,
 * then the line steps back a little and rests.
 *
 * snapcn measured every number here off a 718 × 394 recording, frame by frame.
 * The scene is laid out in those units and scaled to the frame. The checkbox
 * never moves: the lead-in is right-aligned to it and the word left-aligned
 * from it, so new copy changes the words' widths, not where the sentence sits.
 *
 * The film's changes: the caller sets the face, colour and checkbox; the caller
 * sets when each word rolls in, so a narrator can say it as it lands; the scene
 * can be drawn larger; and both halves share the word's baseline (the recording
 * set the lead-in 2 units higher, which reads as a slip in a pixel face).
 */

const REF_W = 718;
const REF_H = 394;

/** Type size of both halves of the sentence, and their baseline. */
const SIZE = 21.78;
const BASELINE = 204.97;
/** The lead-in is right-aligned to this x. */
const LEAD_END = 340.04;
/** The word starts at this x. */
const WORD_X = 379.1;

/** The checkbox's box. The caller's checkbox is drawn in these units, from its top left. */
export const BOX = { x: 345.11, y: 183.71, w: 27.03, h: 27.59 } as const;

/** The slot the words roll through, a hard clip top and bottom. */
const SLOT = [171.37, 223.62] as const;
/** The words move as one strip, travelling these distances on alternate rolls. */
const TRAVEL = [44.19, 42.27] as const;
/** Each roll takes half a second on the in-out cubic. */
const ROLL_FOR = 0.5;
const ROLL_EASE = Easing.bezier(0.65, 0, 0.35, 1);
/** How long the last word holds after its roll starts, before the step back. */
const HOLD = 1.004;
/** The step back: the line shrinks about this point to 0.8, then rests. */
const PIVOT = [359.14, 197.52] as const;
const ZOOM_TO = 0.8;
const ZOOM_FOR = 0.6;
const ZOOM_REST = 0.2;

const unit = (value: number) => Math.min(1, Math.max(0, value));

/** How far the strip has travelled `now` seconds in, for rolls starting at `rolls`. */
function travelled(now: number, rolls: readonly number[]) {
  let distance = 0;
  for (const [roll, at] of rolls.entries()) distance += (TRAVEL[roll % TRAVEL.length] ?? 0) * ROLL_EASE(unit((now - at) / ROLL_FOR));
  return distance;
}

/** Where word `index` rests on the strip. */
function rest(index: number) {
  let distance = 0;
  for (let roll = 0; roll < index; roll++) distance += TRAVEL[roll % TRAVEL.length] ?? 0;
  return distance;
}

/** When the step back starts, in seconds. */
function stepBackAt(rolls: readonly number[]) {
  return (rolls.at(-1) ?? 0) + HOLD;
}

/** Seconds from the first frame to the end of the rest after the step back. */
export function checkCycleLength(rolls: readonly number[]) {
  return stepBackAt(rolls) + ZOOM_FOR + ZOOM_REST;
}

/**
 * A line of type that can sit, and move, a fraction of a pixel. Chrome rounds
 * a glyph run's baseline to a whole device pixel, so a word lifting off slowly
 * would hold still and then jump. The line is painted twice, one device pixel
 * apart, each copy on a whole pixel, and the copies are cross-faded by the
 * fraction between. `plus-lighter` adds their coverage, so the blend is linear.
 */
function Line({
  x,
  y,
  device,
  anchor,
  style,
  children,
}: {
  readonly x: number;
  readonly y: number;
  /** A baseline at scene y lands on device row `a·y + b`. */
  readonly device: { readonly a: number; readonly b: number };
  readonly anchor?: "end";
  readonly style: CSSProperties;
  readonly children: string;
}) {
  const row = device.a * y + device.b;
  const low = Math.floor(row);
  const fraction = row - low;
  const sceneY = (deviceRow: number) => (deviceRow + 1e-3 - device.b) / device.a;
  const copies = [
    { row: low, weight: 1 - fraction },
    { row: low + 1, weight: fraction },
  ];

  return (
    <g style={{ isolation: "isolate" }}>
      {copies.map((copy) => (
        <text key={copy.row} x={x} y={sceneY(copy.row)} textAnchor={anchor} style={{ ...style, opacity: copy.weight, mixBlendMode: "plus-lighter" }}>
          {children}
        </text>
      ))}
    </g>
  );
}

export interface CheckCycleProps {
  /** The part of the sentence that never changes. */
  readonly headline: string;
  /** The words that finish it, rolled through in order. The scene holds on the last. */
  readonly words: readonly string[];
  /** Seconds from the scene's start at which each word after the first starts rolling in. */
  readonly rolls: readonly number[];
  /** Drawn at the box's top left, in scene units (`BOX.w` × `BOX.h`). */
  readonly checkbox: ReactNode;
  readonly color: string;
  readonly fontFamily: string;
  readonly fontWeight?: number;
  /** How much larger than the reference fitted to the frame. */
  readonly scale?: number;
}

export function CheckCycle({ headline, words, rolls, checkbox, color, fontFamily, fontWeight = 500, scale = 1 }: CheckCycleProps) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const slot = `${useId().replace(/[^\w-]/g, "")}-slot`;

  const now = frame / fps;
  const u = Math.min(width / REF_W, height / REF_H) * scale;
  const shift = travelled(now, rolls);
  const zoom = 1 - (1 - ZOOM_TO) * ROLL_EASE(unit((now - stepBackAt(rolls)) / ZOOM_FOR));

  const left = (width - REF_W * u) / 2;
  const top = (height - REF_H * u) / 2;
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const [x0, y0] = PIVOT;
  const device = { a: dpr * u * zoom, b: dpr * (top + u * y0 * (1 - zoom)) };

  const type = {
    fontFamily,
    fontWeight,
    fontSize: SIZE,
    fill: color,
    textRendering: "geometricPrecision",
  } as const;

  return (
    <AbsoluteFill>
      <svg width={REF_W * u} height={REF_H * u} viewBox={`0 0 ${REF_W} ${REF_H}`} style={{ position: "absolute", left, top, overflow: "visible" }}>
        <defs>
          <clipPath id={slot}>
            <rect x={0} y={SLOT[0]} width={REF_W} height={SLOT[1] - SLOT[0]} />
          </clipPath>
        </defs>

        <g transform={`translate(${x0} ${y0}) scale(${zoom}) translate(${-x0} ${-y0})`}>
          <Line x={LEAD_END} y={BASELINE} device={device} anchor="end" style={type}>
            {headline}
          </Line>

          <g transform={`translate(${BOX.x} ${BOX.y})`}>{checkbox}</g>

          <g clipPath={`url(#${slot})`}>
            {words.map((word, index) => {
              const y = BASELINE + rest(index) - shift;
              if (Math.abs(y - BASELINE) > SLOT[1] - SLOT[0] + SIZE) return null;
              return (
                <Line key={`${index}-${word}`} x={WORD_X} y={y} device={device} style={type}>
                  {word}
                </Line>
              );
            })}
          </g>
        </g>
      </svg>
    </AbsoluteFill>
  );
}
