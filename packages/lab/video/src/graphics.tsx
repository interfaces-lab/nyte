import type { ReactNode } from "react";
import { Easing, interpolate } from "remotion";
import moon from "../moon.json";

export const colour = {
  background: "#0b0e15",
  surface: "#111722",
  raised: "#182131",
  text: "#f1f2f6",
  muted: "#929eaf",
  line: "#344255",
  blue: "#b7caff",
  green: "#a1d9bd",
  amber: "#e7c894",
};

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export function reveal(frame: number, start: number, duration = 22) {
  return interpolate(frame, [start, start + duration], [0, 1], {
    ...clamp,
    easing: Easing.bezier(0.22, 1, 0.36, 1),
  });
}

export function Mark({
  x,
  y,
  size,
}: {
  readonly x: number;
  readonly y: number;
  readonly size: number;
}) {
  const cell = size / moon.size;

  return (
    <g transform={`translate(${x} ${y})`}>
      {moon.cells.map(({ x, y, lit }) =>
        lit ? (
          <rect
            key={`${x}-${y}`}
            x={x * cell}
            y={y * cell}
            width={cell * 0.84}
            height={cell * 0.84}
            fill={colour.blue}
          />
        ) : null,
      )}
    </g>
  );
}

export function Label({
  x,
  y,
  children,
  size = 30,
  tone = colour.text,
  mono = false,
  anchor = "start",
  weight = 400,
}: {
  readonly x: number;
  readonly y: number;
  readonly children: ReactNode;
  readonly size?: number;
  readonly tone?: string;
  readonly mono?: boolean;
  readonly anchor?: "start" | "middle" | "end";
  readonly weight?: number;
}) {
  return (
    <text
      x={x}
      y={y}
      fill={tone}
      fontSize={size}
      fontWeight={weight}
      textAnchor={anchor}
      fontFamily={mono ? "'SF Mono', Menlo, monospace" : "inherit"}
      letterSpacing={mono ? -0.6 : -0.4}
    >
      {children}
    </text>
  );
}

export function Panel({
  x,
  y,
  width,
  height,
  title,
  tone = colour.line,
  children,
  opacity = 1,
}: {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly title: string;
  readonly tone?: string;
  readonly children?: ReactNode;
  readonly opacity?: number;
}) {
  return (
    <g opacity={opacity}>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={18}
        fill={colour.surface}
        stroke={tone}
        strokeWidth={2}
      />
      <Label x={x + 25} y={y + 43} size={26} tone={colour.muted}>
        {title}
      </Label>
      {children}
    </g>
  );
}

export function Chip({
  x,
  y,
  text,
  tone = colour.blue,
  width,
}: {
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly tone?: string;
  readonly width?: number;
}) {
  const chipWidth = width ?? text.length * 15 + 38;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={chipWidth}
        height={47}
        rx={10}
        fill={colour.raised}
        stroke={tone}
        strokeWidth={1.5}
      />
      <Label x={x + 19} y={y + 31} size={23} tone={tone} mono>
        {text}
      </Label>
    </g>
  );
}

export function Wire({
  path,
  progress = 1,
  tone = colour.line,
  width = 3,
}: {
  readonly path: string;
  readonly progress?: number;
  readonly tone?: string;
  readonly width?: number;
}) {
  return (
    <path
      d={path}
      pathLength={1}
      fill="none"
      stroke={tone}
      strokeWidth={width}
      strokeLinecap="round"
      strokeDasharray={1}
      strokeDashoffset={1 - progress}
    />
  );
}

export function Step({
  x,
  y,
  title,
  subtitle,
  active = false,
  tone = colour.blue,
  opacity = 1,
}: {
  readonly x: number;
  readonly y: number;
  readonly title: string;
  readonly subtitle: string;
  readonly active?: boolean;
  readonly tone?: string;
  readonly opacity?: number;
}) {
  return (
    <g opacity={opacity}>
      <circle
        cx={x}
        cy={y}
        r={active ? 18 : 12}
        fill={active ? tone : colour.background}
        stroke={tone}
        strokeWidth={3}
      />
      {active && (
        <circle
          cx={x}
          cy={y}
          r={29}
          fill="none"
          stroke={tone}
          strokeOpacity={0.23}
          strokeWidth={2}
        />
      )}
      <Label x={x} y={y + 65} anchor="middle" size={29}>
        {title}
      </Label>
      <Label x={x} y={y + 102} anchor="middle" size={23} tone={colour.muted} mono>
        {subtitle}
      </Label>
    </g>
  );
}

export function SessionShell({
  session,
  children,
  opacity = 1,
}: {
  readonly session: string;
  readonly children?: ReactNode;
  readonly opacity?: number;
}) {
  return (
    <Panel
      x={140}
      y={420}
      width={1640}
      height={420}
      title={`session / ${session.slice(0, 8)}`}
      tone={colour.line}
      opacity={opacity}
    >
      <Chip x={1510} y={443} text="head: main" width={235} />
      {children}
    </Panel>
  );
}

export function Code({
  x,
  y,
  lines,
  size = 29,
  active = -1,
  width = 1530,
}: {
  readonly x: number;
  readonly y: number;
  readonly lines: readonly string[];
  readonly size?: number;
  readonly active?: number;
  readonly width?: number;
}) {
  return (
    <g>
      {lines.map((line, index) => (
        <g key={index}>
          {active === index && (
            <rect
              x={x - 14}
              y={y + index * 47 - 32}
              width={width}
              height={44}
              rx={6}
              fill={colour.blue}
              fillOpacity={0.08}
            />
          )}
          <Label
            x={x}
            y={y + index * 47}
            size={size}
            tone={active === index ? colour.blue : colour.text}
            mono
          >
            {line}
          </Label>
        </g>
      ))}
    </g>
  );
}
