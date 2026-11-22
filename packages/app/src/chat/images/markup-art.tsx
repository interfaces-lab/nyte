import { platformColors } from "@nyte-ai/ui/platform-colors";
import { platformRamps } from "@nyte-ai/ui/platform-ramps";
import type { ReactElement } from "react";
import { distance, mix } from "./markup-geometry.ts";
import type { Point, Size } from "./markup-geometry.ts";
import {
  arrowPaths,
  boxPath,
  chiselSweep,
  circleSpine,
  circleTaper,
  highlighterColor,
  inkColor,
  markBounds,
  openPath,
  outline,
  poolColor,
  strokeBody,
} from "./markup.ts";
import type { Mark, Stroke } from "./markup.ts";

export type Tone = "light" | "dark";

const REVEAL = platformColors.light.bgBase;

const CARVE = platformRamps.gray.opaque["150"];

const SHADOW = {
  light: platformColors.light.bgScrim,
  dark: platformColors.dark.contentPrimary,
} as const;

const DYE = { light: { mixBlendMode: "multiply" }, dark: { mixBlendMode: "screen" } } as const;

const HIGHLIGHT_OPACITY = 0.9;

export function layerOrder(mark: Mark): number {
  return mark.kind === "highlight" ? 0 : 1;
}

export function MarkedPhoto(input: {
  readonly src: string;
  readonly size: Size;
  readonly transform: DOMMatrix;
  readonly marks: readonly Mark[];
  readonly tone: Tone;
  readonly prefix: string;
}): ReactElement {
  return (
    <g transform={input.transform.toString()}>
      <image
        href={input.src}
        width={input.size.width}
        height={input.size.height}
        preserveAspectRatio="none"
      />
      {[...input.marks]
        .sort((a, b) => layerOrder(a) - layerOrder(b))
        .map((mark) => (
          <MarkArt
            key={mark.id}
            mark={mark}
            spine={undefined}
            tone={input.tone}
            prefix={input.prefix}
            erasing={false}
          />
        ))}
    </g>
  );
}

/** Effects carry inline styles, not classes: an SVG drawn as an image can't see the page's CSS. */
export function MarkArt(input: {
  readonly mark: Mark;
  readonly spine: readonly Point[] | undefined;
  readonly tone: Tone;
  readonly prefix: string;
  readonly erasing: boolean;
}): ReactElement {
  const mark = input.mark;
  const id = `${input.prefix}m${String(mark.id).replace("-", "d")}`;
  const seed = Math.abs(mark.id * 37.17) % 97;
  const box = markBounds(mark, input.spine);
  const region = { filterUnits: "userSpaceOnUse", ...box } as const;
  const shadow = `url(#${id}s)`;

  const shadowFilter = (
    <filter id={`${id}s`} {...region}>
      <feDropShadow
        dx={0}
        dy={input.tone === "light" ? mark.width * 0.25 : 0}
        stdDeviation={mark.width * 0.6}
        floodColor={SHADOW[input.tone]}
        floodOpacity={input.tone === "light" ? 1 : 0.45}
      />
    </filter>
  );

  const fade = input.erasing ? 0.2 : undefined;

  if (mark.kind === "pen") {
    const body = strokeBody(mark.points, mark.width, "pen");

    return (
      <g data-image-mark="pen" opacity={fade}>
        <defs>{shadowFilter}</defs>
        <path d={outline(body.points, body.radii)} fill={inkColor(mark.ink)} filter={shadow} />
      </g>
    );
  }

  if (mark.kind === "highlight") {
    return (
      <Highlight
        mark={mark}
        spine={input.spine}
        id={id}
        seed={seed}
        tone={input.tone}
        fade={fade}
        box={box}
      />
    );
  }

  if (mark.kind === "circle") {
    const points = input.spine ?? circleSpine(mark);

    return (
      <g data-image-mark="circle" opacity={fade}>
        <defs>{shadowFilter}</defs>
        <path
          d={outline(
            points,
            points.map((_, index) => (mark.width / 2) * circleTaper(index / (points.length - 1))),
          )}
          fill={inkColor(mark.ink)}
          filter={shadow}
        />
      </g>
    );
  }

  if (mark.kind === "box") {
    return (
      <g data-image-mark="box" opacity={fade}>
        <defs>{shadowFilter}</defs>
        <path
          d={boxPath(mark.frame, mark.width)}
          fill="none"
          stroke={inkColor(mark.ink)}
          strokeWidth={mark.width}
          strokeLinejoin="round"
          filter={shadow}
        />
      </g>
    );
  }

  const arrow = arrowPaths(mark.from, mark.to, mark.width);

  return (
    <g data-image-mark="arrow" opacity={fade} filter={shadow} fill={inkColor(mark.ink)}>
      <defs>{shadowFilter}</defs>
      <path d={arrow.shaft} />
      {arrow.head !== undefined && (
        <path
          d={arrow.head}
          stroke={inkColor(mark.ink)}
          strokeWidth={mark.width * 0.7}
          strokeLinejoin="round"
        />
      )}
    </g>
  );
}

function Highlight(input: {
  readonly mark: Stroke<"highlight">;
  readonly spine: readonly Point[] | undefined;
  readonly id: string;
  readonly seed: number;
  readonly tone: Tone;
  readonly fade: number | undefined;
  readonly box: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}): ReactElement {
  const mark = input.mark;
  const points = input.spine ?? mark.points;
  const sweep = chiselSweep(points, mark.width, mark.axis, input.seed);
  const first = points[0] ?? { x: 0, y: 0 };
  const last = farEnd(first, points.at(-1) ?? first, mark.width);
  const slant = mark.axis + Math.PI / 2 - 0.34;
  const id = input.id;

  return (
    <g
      data-image-mark="highlight"
      opacity={input.fade ?? HIGHLIGHT_OPACITY}
      style={DYE[input.tone]}
    >
      <defs>
        <linearGradient
          id={`${id}p`}
          gradientUnits="userSpaceOnUse"
          x1={first.x}
          y1={first.y}
          x2={last.x}
          y2={last.y}
        >
          <stop offset={0} stopColor={poolColor(mark.ink)} />
          <stop offset={0.07} stopColor={highlighterColor(mark.ink)} />
          <stop offset={0.6} stopColor={mixHex(highlighterColor(mark.ink), REVEAL, 0.22)} />
          <stop offset={0.93} stopColor={highlighterColor(mark.ink)} />
          <stop offset={1} stopColor={poolColor(mark.ink)} />
        </linearGradient>
        <mask id={`${id}k`} maskUnits="userSpaceOnUse" {...input.box}>
          <rect {...input.box} fill={REVEAL} />
          {Array.from({ length: 5 }, (_, index) => {
            const offset = (wobble(input.seed, index) * 1.6 - 0.8) * (mark.width / 2);

            return (
              <path
                key={index}
                d={openPath(
                  points.map((point) => ({
                    x: point.x + Math.cos(slant) * offset,
                    y: point.y + Math.sin(slant) * offset,
                  })),
                )}
                fill="none"
                stroke={CARVE}
                strokeOpacity={0.12 + wobble(input.seed, index + 5) * 0.2}
                strokeWidth={mark.width * (0.02 + wobble(input.seed, index + 11) * 0.035)}
              />
            );
          })}
        </mask>
        <filter id={`${id}f`} filterUnits="userSpaceOnUse" {...input.box}>
          <feTurbulence
            type="fractalNoise"
            baseFrequency={`${0.45 / mark.width} ${1.6 / mark.width}`}
            numOctaves={2}
            seed={input.seed}
            result="noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale={mark.width * 0.12}
            xChannelSelector="R"
            yChannelSelector="G"
            result="frayed"
          />
          <feGaussianBlur in="frayed" stdDeviation={mark.width * 0.02} />
        </filter>
      </defs>
      <g mask={`url(#${id}k)`} filter={`url(#${id}f)`}>
        <path
          d={sweep.body}
          fill={`url(#${id}p)`}
          stroke={`url(#${id}p)`}
          strokeWidth={mark.width * 0.16}
          strokeLinejoin="round"
        />
        <path d={sweep.start} fill={poolColor(mark.ink)} opacity={0.6} />
        <path d={sweep.end} fill={poolColor(mark.ink)} opacity={0.5} />
      </g>
    </g>
  );
}

function farEnd(first: Point, last: Point, width: number): Point {
  return distance(first, last) < width ? { x: first.x + width, y: first.y } : last;
}

function wobble(seed: number, index: number): number {
  const value = Math.sin(seed * 12.9898 + index * 78.233) * 43_758.5453;

  return value - Math.floor(value);
}

function mixHex(a: string, b: string, t: number): string {
  const channel = (hex: string, at: number) =>
    Number.parseInt(hex.slice(1 + at * 2, 3 + at * 2), 16);

  const parts = [0, 1, 2].map((at) =>
    Math.round(mix(channel(a, at), channel(b, at), t))
      .toString(16)
      .padStart(2, "0"),
  );

  return `#${parts.join("")}`;
}
