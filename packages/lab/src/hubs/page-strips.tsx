import { create, keyframes, props } from "@stylexjs/stylex";
import { useReducedMotion } from "motion/react";
import type { ReactElement } from "react";
import { motion, role } from "@nyte-ai/ui/styles/vars.stylex";
import {
  BOARD,
  CELL,
  Chip,
  Field,
  Frame,
  Label,
  Level,
  SPREAD,
  Strip,
  ink,
  noise,
  plot,
  smooth,
  spectrum,
} from "./strip";
import { AdvancedStrip, BrowserStrip, EditorStrip, TerminalStrip } from "./tool-strips";

const PICKER = { x: 73 * CELL, y: 60, w: 5 * CELL, h: 84 } as const;

/** Degrees between bands here: a hue picker shows the whole wheel. */
const HUE_STEP = 18;

const RULER = [-4, -2, 0, 2, 4] as const;

/** Ruler ticks and their labels sit on the same two lines in every strip. */
const TICK = { top: 172, bottom: 177, label: 187 } as const;

function brush(x: number, y: number, column: number, row: number): number {
  const centre = 100 + 24 * Math.sin((x - 600) / 140) + 7 * Math.sin((x - 600) / 47);
  const half = 36 - 12 * Math.abs(Math.sin((x - 600) / 260));
  const across = Math.abs(y - centre) / half;

  if (across >= 1) return 0;
  const bristle = noise(row, 3) < 0.22 ? 0.55 : 1;

  return (1 - across * across) * bristle * (0.8 + 0.2 * noise(column, row));
}

/** The picked band glitters more than the rest. */
const STROKE = plot(brush, (column) =>
  column * CELL >= PICKER.x && column * CELL < PICKER.x + PICKER.w ? 0.2 : 0.04,
);

function hueLabel(value: number): string {
  return `${String(((Math.round(value) % 360) + 360) % 360)}°`;
}

export function AppearanceStrip({
  hue,
  intensity,
}: {
  readonly hue: number;
  readonly intensity: number;
}): ReactElement {
  const centre = PICKER.x + PICKER.w / 2;

  return (
    <Strip
      prism={spectrum(hue, HUE_STEP)}
      chroma={intensity / 100}
      backdrop={<Field plot={STROKE} twinkle />}
    >
      <Frame x={PICKER.x} y={PICKER.y} w={PICKER.w} h={PICKER.h} />
      <Chip x={PICKER.x} y={PICKER.y + 9} label={hueLabel(hue)} />
      <Label x={centre} y={PICKER.y + PICKER.h + 13} align="middle">
        {`Intensity ${String(intensity)}%`}
      </Label>
      {RULER.map((offset) => {
        const x = centre + offset * PICKER.w;

        return (
          <g key={offset}>
            <path
              d={`M${x} ${TICK.top}V${TICK.bottom}`}
              {...props(offset === 0 ? ink.mark : ink.faint)}
            />
            {offset !== 0 && (
              <Label x={x} y={TICK.label} align="middle">
                {hueLabel(hue + offset * HUE_STEP)}
              </Label>
            )}
          </g>
        );
      })}
    </Strip>
  );
}

/** The run General draws: framed while it works, flat and asleep on either side. */
const RUN = { x: 424, y: 40, w: 360, h: 120 } as const;

const NOTIFIED = { x: 812, y: BOARD.cy } as const;

/**
 * A chat run as a waveform. Outside the run there is only a faint pulse; in
 * it each column is a bar of its own height under a swelling envelope, bright
 * at its spine and fading at its tips.
 */
function pulse(x: number, y: number, column: number, row: number): number {
  const end = RUN.x + RUN.w;
  const awake = smooth(RUN.x, RUN.x + 56, x) * (1 - smooth(end - 56, end, x));
  const phrase = 0.5 + 0.5 * Math.sin((x - RUN.x) / 11 + 1.2 * Math.sin((x - RUN.x) / 43));
  const grain = 0.3 + 0.7 * noise(column, 1);
  const swell = 6 + 54 * awake * (0.4 + 0.6 * phrase) * grain;
  const blip = noise(column, 7) > 0.88 ? 10 + 8 * noise(column, 8) : 0;
  const reach = Math.max(swell, blip * (1 - awake));
  const off = Math.abs(y - BOARD.cy);
  const ping = Math.exp(-((x - NOTIFIED.x) ** 2 + (y - NOTIFIED.y) ** 2) / 100);

  if (off > reach) return ping;
  const bar = 0.5 + 0.5 * (1 - off / reach) ** 0.5;
  const wave = bar * (0.3 + 0.7 * awake) * (0.85 + 0.15 * noise(column, row));

  return Math.max(ping, wave);
}

const PULSE = plot(pulse, () => 0.14);

const RUN_TICKS = Array.from({ length: RUN.w / 40 + 1 }, (_, index) => RUN.x + index * 40);

export function GeneralStrip(): ReactElement {
  return (
    <Strip prism={spectrum(70)} backdrop={<Field plot={PULSE} twinkle />}>
      <Frame x={RUN.x} y={RUN.y} w={RUN.w} h={RUN.h} />
      <Chip x={RUN.x} y={RUN.y + 9} label="Kept awake" />
      <circle cx={NOTIFIED.x} cy={NOTIFIED.y} r={5} {...props(ink.mark, styles.ping)} />
      <Label x={NOTIFIED.x} y={NOTIFIED.y - 20} align="middle">
        Notified
      </Label>
      <path
        d={RUN_TICKS.map((x) => `M${x} ${TICK.top}V${TICK.bottom - 2}`).join("")}
        {...props(ink.faint)}
      />
      <path
        d={`M${RUN.x} ${TICK.top}V${TICK.bottom}M${RUN.x + RUN.w} ${TICK.top}V${TICK.bottom}`}
        {...props(ink.mark)}
      />
      <Label x={RUN.x} y={TICK.label} align="middle">
        9:41
      </Label>
      <Label x={RUN.x + RUN.w} y={TICK.label} align="middle">
        9:45
      </Label>
    </Strip>
  );
}

const TODAY = 100;

const FLOOR = 160;

const DAYS = Array.from({ length: TODAY + 1 }, (_, day) => {
  const weekend = day % 7 === 0 || day % 7 === 6;

  const level =
    0.42 +
    (0.3 * day) / TODAY +
    0.12 * Math.sin(day * 0.29 + 1.3) +
    0.22 * (noise(day, 5) - 0.5) -
    (weekend ? 0.24 : 0);

  const cells = Math.max(1, Math.min(14, Math.round(level * 14)));
  const opus = Math.round(cells * (0.46 + 0.12 * noise(day, 9)));
  const gpt = Math.round(cells * (0.2 + 0.08 * noise(day, 11)));

  return { cells, bands: [opus, opus + gpt, opus + gpt + Math.round(cells * 0.16)] } as const;
});

function forecast(column: number): number {
  return Math.max(
    1,
    Math.min(
      14,
      Math.round((0.42 + (0.3 * column) / TODAY + 0.12 * Math.sin(column * 0.29 + 1.3)) * 14),
    ),
  );
}

/** One column a day, stacked by model; after today, a dotted forecast. */
const TERRAIN = plot(
  (_x, _y, column, row) => {
    const height = FLOOR / CELL - 1 - row;
    const day = DAYS[column];

    if (height < 0) return 0;

    if (day === undefined) return height === forecast(column) - 1 ? 0.5 : 0;

    if (height >= day.cells) return 0;

    if (height < day.bands[0]) return 1;

    if (height < day.bands[1]) return 0.75;

    return height < day.bands[2] ? 0.5 : 0.25;
  },
  () => 0.06,
);

const AVERAGE = FLOOR - (DAYS.reduce((total, day) => total + day.cells, 0) / DAYS.length) * CELL;

/** This week: one band of the prism, with room above its tallest day for the chip. */
const WEEK = (() => {
  const tallest = Math.max(...DAYS.slice(-7).map((day) => day.cells));
  const top = FLOOR - (tallest + 3) * CELL;

  return { x: (TODAY - 6) * CELL, y: top, w: 7 * CELL, h: FLOOR - top };
})();

const LATEST = { x: TODAY * CELL + CELL / 2, y: FLOOR - (DAYS[TODAY]?.cells ?? 1) * CELL - 4 };

const DAY_TICKS = Array.from({ length: BOARD.w / CELL }, (_, column) => {
  const x = column * CELL + CELL / 2;

  return (TODAY - column) % 7 === 0
    ? `M${x} ${FLOOR + 2}V${FLOOR + 7}`
    : `M${x} ${FLOOR + 2}V${FLOOR + 4}`;
}).join("");

const MONTHS = [
  { column: 60, label: "Sep" },
  { column: 90, label: "Oct" },
] as const;

export function UsageStrip(): ReactElement {
  return (
    <Strip
      prism={{ hue: 35, step: SPREAD, width: 7, anchor: TODAY - 6 }}
      backdrop={
        <g>
          <Field plot={TERRAIN} />
          <path d={`M0 ${FLOOR + 0.5}H${BOARD.w}`} {...props(ink.strong)} />
          <path d={DAY_TICKS} {...props(ink.faint, styles.butt)} />
          <Level from={{ x: 0, y: AVERAGE }} to={{ x: WEEK.x, y: AVERAGE }} />
        </g>
      }
    >
      {MONTHS.map((month) => (
        <Label key={month.label} x={month.column * CELL + 1} y={FLOOR + 16}>
          {month.label}
        </Label>
      ))}
      <Chip x={352} y={AVERAGE - 12} label="Avg 171K a day" tone="lit" />
      <Frame x={WEEK.x} y={WEEK.y} w={WEEK.w} h={WEEK.h} />
      <Chip x={WEEK.x} y={WEEK.y + 9} label="$12.40" />
      <Label x={WEEK.x + WEEK.w / 2} y={FLOOR + 16} align="middle">
        7 days
      </Label>
      <circle cx={LATEST.x} cy={LATEST.y} r={4} {...props(ink.mark, styles.ping)} />
      <circle cx={LATEST.x} cy={LATEST.y} r={2.4} {...props(ink.markFill)} />
    </Strip>
  );
}

const PLANET = { x: 604, y: BOARD.cy, r: 30 } as const;

/**
 * One ring per reasoning effort, innermost first; the lit ones are the effort
 * in use. Only the innermost passes behind the planet; the others clear it by
 * a row, so their far arcs never merge into its outline.
 */
const ORBITS = [
  { rx: 92, ry: 22, label: "Low", lit: true },
  { rx: 140, ry: 40, label: "Medium", lit: true },
  { rx: 190, ry: 56, label: "High", lit: false },
] as const;

type Orbit = (typeof ORBITS)[number];

const EFFORT = ORBITS[1];

const SUN = (() => {
  const length = Math.hypot(0.55, 0.62, 0.56);

  return { x: -0.55 / length, y: -0.62 / length, z: 0.56 / length };
})();

/** About how far (x, y) sits from an orbit, in pixels: the ellipse's value over its slope. */
function orbitDistance(x: number, y: number, orbit: Orbit): number {
  const dx = x - PLANET.x;
  const dy = y - PLANET.y;
  const slope = 2 * Math.hypot(dx / orbit.rx ** 2, dy / orbit.ry ** 2);

  return slope === 0
    ? Number.POSITIVE_INFINITY
    : Math.abs((dx / orbit.rx) ** 2 + (dy / orbit.ry) ** 2 - 1) / slope;
}

/**
 * The model as a lit planet and its reasoning as rings. A ring's far half
 * passes behind the planet; its near half crosses in front, with a gap cut
 * around it so it reads as in front.
 */
const SYSTEM = plot(
  (x, y) => {
    const dx = (x - PLANET.x) / PLANET.r;
    const dy = (y - PLANET.y) / PLANET.r;
    const reach = dx * dx + dy * dy;
    const near = y >= PLANET.y;
    const distances = ORBITS.map((orbit) => orbitDistance(x, y, orbit));

    const ring =
      reach < 1 && !near
        ? 0
        : Math.max(
            ...ORBITS.map(
              (orbit, index) =>
                (orbit.lit ? 1.3 : 0.45) *
                (near ? 1 : 0.7) *
                Math.exp(-((distances[index] ?? Number.POSITIVE_INFINITY) ** 2) / 25),
            ),
          );

    if (reach >= 1) return ring;
    const gap = near ? Math.min(...distances.map((distance) => smooth(4, 10, distance))) : 1;
    const lambert = Math.max(0, dx * SUN.x + dy * SUN.y + Math.sqrt(1 - reach) * SUN.z);

    return Math.max(ring, (0.16 + 0.84 * lambert) * gap);
  },
  () => 0.2,
);

const MODEL = { x: 556, y: 52, w: 96, h: 96 } as const;

/** The reasoning scale under the rings: Off at the planet, then each ring's outer edge. */
const STOPS = [
  { x: PLANET.x, label: "Off" },
  ...ORBITS.map((orbit) => ({ x: PLANET.x + orbit.rx, label: orbit.label })),
];

const RIDER_PATH = `M${PLANET.x - EFFORT.rx},${PLANET.y} a${EFFORT.rx},${EFFORT.ry} 0 1,0 ${2 * EFFORT.rx},0 a${EFFORT.rx},${EFFORT.ry} 0 1,0 ${-2 * EFFORT.rx},0`;

const RIDER_SECONDS = 14;

/** Where riders wait when motion is reduced: on the near side, either side of the planet. */
const RESTING = [0.35, 0.8].map((turn) => ({
  x: PLANET.x + EFFORT.rx * Math.cos(Math.PI * turn),
  y: PLANET.y + EFFORT.ry * Math.sin(Math.PI * turn),
}));

export function AgentStrip(): ReactElement {
  const still = useReducedMotion() === true;

  return (
    <Strip prism={spectrum(295)} backdrop={<Field plot={SYSTEM} twinkle />}>
      {RESTING.map((rest, index) => (
        <g key={index} transform={still ? `translate(${rest.x} ${rest.y})` : undefined}>
          {!still && (
            <animateMotion
              dur={`${String(RIDER_SECONDS)}s`}
              begin={`${String((-index * RIDER_SECONDS) / RESTING.length)}s`}
              repeatCount="indefinite"
              path={RIDER_PATH}
            />
          )}
          <circle r={3.2} {...props(styles.rider)} />
        </g>
      ))}
      <Frame x={MODEL.x} y={MODEL.y} w={MODEL.w} h={MODEL.h} />
      <Chip x={MODEL.x} y={MODEL.y + 9} label="Opus 4.5" icon="model-anthropic" />
      {STOPS.map((stop) => (
        <g key={stop.label}>
          <path
            d={`M${stop.x} ${TICK.top}V${TICK.bottom}`}
            {...props(stop.label === EFFORT.label ? ink.mark : ink.faint)}
          />
          <Label
            x={stop.x}
            y={TICK.label}
            align="middle"
            tone={stop.label === EFFORT.label ? "primary" : "tertiary"}
          >
            {stop.label}
          </Label>
        </g>
      ))}
    </Strip>
  );
}

export const PAGE_STRIPS = {
  general: GeneralStrip,
  usage: UsageStrip,
  agent: AgentStrip,
  editor: EditorStrip,
  terminal: TerminalStrip,
  browser: BrowserStrip,
  advanced: AdvancedStrip,
} as const;

const ripple = keyframes({
  from: { transform: "scale(1)", opacity: 0.8 },
  to: { transform: "scale(3.2)", opacity: 0 },
});

const reduced = "@media (prefers-reduced-motion: reduce)";

const styles = create({
  butt: { strokeLinecap: "butt" },
  ping: {
    transformBox: "fill-box",
    transformOrigin: "center",
    animationName: { default: ripple, [reduced]: "none" },
    animationDuration: "2s",
    animationIterationCount: "infinite",
    animationTimingFunction: motion.easeOut,
  },
  rider: { fill: role.contentPrimary, stroke: role.bgBase, strokeWidth: 1.5 },
});
