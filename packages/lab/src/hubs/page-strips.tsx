/**
 * Strips for the settings pages that don't connect anything: one emblem per
 * page in its own hue. Appearance paints with the hue the user picks; the
 * rest are still lifes with a little motion, all of it off under reduced
 * motion.
 */
import { create, keyframes, props } from "@stylexjs/stylex";
import { useReducedMotion } from "motion/react";
import { useContext, type ReactElement } from "react";
import type { IconName } from "@nyte-ai/ui/icon";
import { surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { motion, role } from "@nyte-ai/ui/styles/vars.stylex";
import { rounded } from "./hub-art";
import { BOARD, Falloff, Glyph, Strip, ink, seeded } from "./strip";
import { AdvancedStrip, BrowserStrip, EditorStrip, TerminalStrip } from "./tool-strips";

/** One well of paint in its own hue: the custom ramp reads the hue where its class lands. */
function Well({
  x,
  y,
  r,
  degrees,
  chroma,
  chosen,
}: {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly degrees: number;
  readonly chroma: number;
  readonly chosen: boolean;
}): ReactElement {
  return (
    <g
      ref={(node) => {
        node?.style.setProperty("--nyte-custom-hue", String(((degrees % 360) + 360) % 360));
        node?.style.setProperty("--nyte-custom-chroma-scale", String(chroma));
      }}
      {...props(surfaceTheme.custom)}
    >
      {chosen && <circle cx={x} cy={y} r={r + 5} {...props(ink.accent, appearance.chosenRing)} />}
      <circle cx={x} cy={y} r={r} {...props(ink.accentFill, appearance.paint)} />
      <ellipse
        cx={x - r * 0.32}
        cy={y - r * 0.36}
        rx={r * 0.34}
        ry={r * 0.2}
        {...props(appearance.gloss)}
      />
    </g>
  );
}

const PALETTE =
  "M486,98 C480,52 548,28 614,30 C684,32 726,64 718,100 C712,124 688,124 672,128 C652,133 664,162 632,170 C590,180 492,152 486,98 Z";

const WELLS = [-75, -50, -25, 0, 25, 50, 75].map((offset, index, all) => {
  const angle = Math.PI * (0.92 - (0.84 * index) / (all.length - 1));

  return { offset, x: 604 + 84 * Math.cos(angle), y: 98 - 44 * Math.sin(angle) };
});

/** Paint chips fanned from one rivet, from no chroma to full; the one nearest the intensity stands out. */
const CHIPS = [0.2, 0.4, 0.6, 0.8, 1];

export function AppearanceStrip({
  hue,
  intensity,
}: {
  readonly hue: number;
  /** 0 to 100. */
  readonly intensity: number;
}): ReactElement {
  const chroma = intensity / 100;

  const nearest = CHIPS.reduce((best, chip) =>
    Math.abs(chip - chroma) < Math.abs(best - chroma) ? chip : best,
  );

  return (
    <Strip
      tint="custom"
      hue={{ degrees: hue, chroma }}
      caption={`Hue ${String(hue)}° · Intensity ${String(intensity)}%`}
    >
      <g {...props(appearance.swoosh)}>
        <path d="M-40,150 C260,50 480,200 780,96 S1080,20 1240,64" {...props(appearance.stroke)} />
        {[-14, -8, 9, 15].map((shift) => (
          <path
            key={shift}
            d={`M-40,${150 + shift} C260,${50 + shift} 480,${200 + shift} 780,${96 + shift} S1080,${20 + shift} 1240,${64 + shift}`}
            {...props(appearance.bristle)}
          />
        ))}
      </g>

      <g>
        {CHIPS.map((chip, index) => (
          <g key={chip} transform={`rotate(${-44 + index * 10} 430 170)`}>
            <g
              ref={(node) => node?.style.setProperty("--nyte-custom-chroma-scale", String(chip))}
              {...props(surfaceTheme.custom)}
            >
              <rect
                x={417}
                y={72}
                width={26}
                height={104}
                rx={5}
                {...props(ink.solid, chip === nearest && appearance.chipChosen)}
              />
              <rect x={420} y={75} width={20} height={58} rx={3} {...props(ink.accentFill)} />
              <rect x={421} y={140} width={12} height={3} rx={1.5} {...props(ink.mutedFill)} />
              <rect x={421} y={147} width={8} height={3} rx={1.5} {...props(ink.mutedFill)} />
            </g>
          </g>
        ))}
        <circle cx={430} cy={166} r={3} {...props(ink.solid)} />
      </g>

      <path
        d={PALETTE}
        transform="translate(5 8)"
        {...props(ink.primaryFill, ink.bloom, appearance.shadow)}
      />
      <path d={PALETTE} {...props(ink.solid, appearance.palette)} />
      <circle cx={540} cy={128} r={11} {...props(ink.line, appearance.thumb)} />
      <path
        d="M590,148 C604,136 628,140 640,146 C650,152 632,160 614,158 C600,157 584,154 590,148 Z"
        {...props(ink.accentFill, appearance.smear)}
      />
      {WELLS.map((well) => (
        <Well
          key={well.offset}
          x={well.x}
          y={well.y}
          r={well.offset === 0 ? 15 : 11}
          degrees={hue + well.offset}
          chroma={Math.max(chroma, 0.04)}
          chosen={well.offset === 0}
        />
      ))}

      <g transform="translate(636 146) rotate(-36)">
        <path d="M0,0 C6,-6 18,-5 24,-4.5 L24,4.5 C18,5 6,6 0,0 Z" {...props(ink.accentFill)} />
        <rect x={24} y={-5} width={18} height={10} rx={1.5} {...props(ink.solid)} />
        <path d="M27,-5 L27,5 M31,-5 L31,5" {...props(ink.faint)} />
        <path
          d="M42,-4.5 L150,-2.6 C154,-2.5 154,2.5 150,2.6 L42,4.5 Z"
          {...props(ink.solid, appearance.handle)}
        />
      </g>
    </Strip>
  );
}

const FADERS = [
  { x: 432, at: 74, drift: 0 },
  { x: 456, at: 112, drift: 1 },
  { x: 480, at: 90, drift: 2 },
  { x: 504, at: 126, drift: 1 },
  { x: 528, at: 82, drift: 0 },
] as const;

const SWITCHES = [
  { y: 58, on: true },
  { y: 92, on: false },
  { y: 126, on: true },
] as const;

function Knob({
  x,
  y,
  value,
}: {
  readonly x: number;
  readonly y: number;
  readonly value: number;
}): ReactElement {
  const start = Math.PI * 0.75;
  const sweep = Math.PI * 1.5;
  const end = start + sweep * value;

  const point = (angle: number, radius: number) => ({
    x: x + radius * Math.cos(angle),
    y: y + radius * Math.sin(angle),
  });

  const from = point(start, 22);
  const to = point(end, 22);
  const tip = point(end, 11);

  return (
    <g>
      {Array.from({ length: 11 }, (_, index) => {
        const angle = start + (sweep * index) / 10;
        const outer = point(angle, 28);
        const inner = point(angle, 26);

        return (
          <path
            key={index}
            d={`M${inner.x},${inner.y} L${outer.x},${outer.y}`}
            {...props(ink.strong)}
          />
        );
      })}
      <path
        d={`M${from.x},${from.y} A22,22 0 ${sweep * value > Math.PI ? 1 : 0} 1 ${to.x},${to.y}`}
        {...props(ink.accent, general.arc)}
      />
      <circle cx={x} cy={y} r={16} {...props(ink.solid)} />
      <path d={`M${x},${y} L${tip.x},${tip.y}`} {...props(ink.line, general.pointer)} />
    </g>
  );
}

export function GeneralStrip(): ReactElement {
  const falloff = useContext(Falloff);

  return (
    <Strip tint="brown">
      <g mask={`url(#${falloff})`}>
        {Array.from({ length: 40 }, (_, index) => {
          const column = index % 10;
          const row = Math.floor(index / 10);
          const x = column < 5 ? 40 + column * 64 : 850 + (column - 5) * 64;
          const on = (column * 7 + row * 3) % 5 < 2;

          return (
            <g key={index} transform={`translate(${x} ${30 + row * 40})`}>
              <rect width={30} height={16} rx={8} {...props(on ? general.trackOn : ink.faint)} />
              <circle
                cx={on ? 22 : 8}
                cy={8}
                r={5}
                {...props(on ? ink.accentFill : ink.strongFill)}
              />
            </g>
          );
        })}
      </g>

      <rect x={400} y={34} width={400} height={132} rx={16} {...props(ink.solid)} />
      {[
        [412, 46],
        [788, 46],
        [412, 154],
        [788, 154],
      ].map(([x = 0, y = 0]) => (
        <g key={`${x},${y}`}>
          <circle cx={x} cy={y} r={3.2} {...props(ink.line)} />
          <path d={`M${x - 1.8},${y + 1.8} L${x + 1.8},${y - 1.8}`} {...props(ink.line)} />
        </g>
      ))}

      {FADERS.map((fader) => (
        <g key={fader.x}>
          <path d={`M${fader.x},56 L${fader.x},146`} {...props(general.slot)} />
          {Array.from({ length: 7 }, (_, index) => (
            <path
              key={index}
              d={`M${fader.x + 8},${58 + index * 14.5} L${fader.x + 11},${58 + index * 14.5}`}
              {...props(ink.faint)}
            />
          ))}
          <g {...props(general.fader, general[`drift${fader.drift}`])}>
            <rect
              x={fader.x - 8}
              y={fader.at - 5}
              width={16}
              height={10}
              rx={2.5}
              {...props(ink.solid)}
            />
            <path
              d={`M${fader.x - 5},${fader.at} L${fader.x + 5},${fader.at}`}
              {...props(ink.accent)}
            />
          </g>
        </g>
      ))}

      <path d="M556,50 L556,150" {...props(ink.faint)} />
      <Knob x={600} y={76} value={0.68} />
      <Knob x={600} y={130} value={0.32} />
      <path d="M644,50 L644,150" {...props(ink.faint)} />

      {SWITCHES.map((toggle) => (
        <g key={toggle.y}>
          <rect
            x={660}
            y={toggle.y}
            width={36}
            height={20}
            rx={10}
            {...props(toggle.on ? general.trackOn : ink.solid)}
          />
          <circle cx={toggle.on ? 686 : 670} cy={toggle.y + 10} r={7} {...props(ink.solid)} />
          <rect
            x={708}
            y={toggle.y + 5}
            width={toggle.on ? 52 : 40}
            height={4}
            rx={2}
            {...props(ink.mutedFill)}
          />
          <rect
            x={708}
            y={toggle.y + 12}
            width={30}
            height={3}
            rx={1.5}
            {...props(ink.mutedFill)}
          />
          <circle
            cx={774}
            cy={toggle.y + 10}
            r={2.6}
            {...props(toggle.on ? ink.accentFill : ink.strongFill)}
          />
        </g>
      ))}
    </Strip>
  );
}

const BAR = { count: 72, width: 10, base: 170 } as const;

const WEEK = { from: 432, to: 768 } as const;

const BARS = (() => {
  const random = seeded(21);
  const step = BOARD.w / BAR.count;

  return Array.from({ length: BAR.count }, (_, index) => {
    const x = index * step + (step - BAR.width) / 2;

    const wave =
      0.5 +
      0.3 * Math.sin(index * 0.42) +
      0.2 * Math.sin(index * 0.13 + 1) +
      (random() - 0.5) * 0.3;

    const height = 14 + 96 * Math.min(1, Math.max(0, wave));
    const week = x >= WEEK.from && x + BAR.width <= WEEK.to;

    return { x, height, week, index };
  });
})();

const WEEK_BARS = BARS.filter((bar) => bar.week);

export function UsageStrip(): ReactElement {
  const falloff = useContext(Falloff);
  const tops = WEEK_BARS.map((bar) => ({ x: bar.x + BAR.width / 2, y: BAR.base - bar.height - 8 }));
  const last = tops.at(-1) ?? { x: WEEK.to, y: BOARD.cy };

  return (
    <Strip tint="orange" caption="1.2M tokens · last 7 days">
      <path d={`M0,${BAR.base + 0.5} L${BOARD.w},${BAR.base + 0.5}`} {...props(ink.strong)} />
      <g mask={`url(#${falloff})`}>
        {BARS.filter((bar) => !bar.week).map((bar) => (
          <rect
            key={bar.index}
            x={bar.x}
            y={BAR.base - bar.height}
            width={BAR.width}
            height={bar.height}
            rx={2.5}
            {...props(ink.mutedFill, usage.bar, usage.delay(`${bar.index * 14}ms`))}
          />
        ))}
      </g>
      <rect
        x={WEEK.from - 8}
        y={20}
        width={WEEK.to - WEEK.from + 16}
        height={164}
        rx={10}
        {...props(usage.window)}
      />
      {WEEK_BARS.map((bar) => (
        <rect
          key={bar.index}
          x={bar.x}
          y={BAR.base - bar.height}
          width={BAR.width}
          height={bar.height}
          rx={2.5}
          {...props(ink.accentFill, usage.bar, usage.delay(`${bar.index * 14}ms`))}
        />
      ))}
      <path d={rounded(tops, 6, false)} {...props(ink.line, usage.line)} />
      {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => (
        <text
          key={index}
          x={WEEK.from + ((WEEK.to - WEEK.from) / 7) * (index + 0.5)}
          y={186}
          {...props(ink.mono, ink.tertiaryFill, usage.day)}
        >
          {day}
        </text>
      ))}
      <circle cx={last.x} cy={last.y} r={4} {...props(ink.accent, usage.ping)} />
      <circle cx={last.x} cy={last.y} r={3.4} {...props(ink.solid, usage.dot)} />
      <g transform={`translate(${last.x - 66} ${last.y - 30})`}>
        <rect width={58} height={18} rx={9} {...props(ink.solid)} />
        <text x={29} y={12.5} {...props(ink.mono, ink.primaryFill, usage.tag)}>
          $12.40
        </text>
      </g>
    </Strip>
  );
}

interface Orbit {
  readonly rx: number;
  readonly ry: number;
  readonly seconds: number;
  readonly riders: readonly IconName[];
}

const ORBITS: readonly Orbit[] = [
  { rx: 118, ry: 38, seconds: 16, riders: ["file-text", "search"] },
  { rx: 206, ry: 62, seconds: 26, riders: ["console", "globe", "pencil"] },
  { rx: 300, ry: 86, seconds: 40, riders: ["git-branch", "mcp", "skills", "pull-request"] },
];

const TWINKLES = (() => {
  const random = seeded(5);

  return Array.from({ length: 26 }, (_, index) => ({
    x: index % 2 === 0 ? 30 + random() * 330 : 840 + random() * 330,
    y: 16 + random() * 168,
    size: 2 + random() * 4,
    delay: `${(random() * 3).toFixed(2)}s`,
  }));
})();

function sparkle(x: number, y: number, size: number): string {
  const waist = size * 0.22;

  return `M${x},${y - size} Q${x + waist},${y - waist} ${x + size},${y} Q${x + waist},${y + waist} ${x},${y + size} Q${x - waist},${y + waist} ${x - size},${y} Q${x - waist},${y - waist} ${x},${y - size} Z`;
}

function ellipsePath(rx: number, ry: number): string {
  return `M${BOARD.cx - rx},${BOARD.cy} a${rx},${ry} 0 1,0 ${rx * 2},0 a${rx},${ry} 0 1,0 ${-rx * 2},0`;
}

/** A small token that rides `path`, or rests at `share` of it under reduced motion. */
function Rider({
  icon,
  orbit,
  share,
}: {
  readonly icon: IconName;
  readonly orbit: Orbit;
  readonly share: number;
}): ReactElement {
  const still = useReducedMotion() === true;
  const angle = Math.PI - share * Math.PI * 2;

  const rest = still
    ? `translate(${BOARD.cx + orbit.rx * Math.cos(angle)} ${BOARD.cy - orbit.ry * Math.sin(angle)})`
    : undefined;

  return (
    <g transform={rest}>
      {!still && (
        <animateMotion
          dur={`${orbit.seconds}s`}
          begin={`${(-share * orbit.seconds).toFixed(2)}s`}
          repeatCount="indefinite"
          path={ellipsePath(orbit.rx, orbit.ry)}
        />
      )}
      <g transform="rotate(8)">
        <circle r={12} {...props(ink.solid)} />
        <Glyph name={icon} x={0} y={0} size={13} />
      </g>
    </g>
  );
}

export function AgentStrip(): ReactElement {
  return (
    <Strip tint="purple">
      {TWINKLES.map((star) => (
        <path
          key={`${star.x},${star.y}`}
          d={sparkle(star.x, star.y, star.size)}
          {...props(ink.accentFill, agent.twinkle, agent.delay(star.delay))}
        />
      ))}
      <g transform={`rotate(-8 ${BOARD.cx} ${BOARD.cy})`}>
        {ORBITS.map((orbit) => (
          <path
            key={orbit.rx}
            d={ellipsePath(orbit.rx, orbit.ry)}
            {...props(ink.strong, agent.orbit)}
          />
        ))}
        {ORBITS.flatMap((orbit) =>
          orbit.riders.map((icon, index) => (
            <Rider
              key={icon}
              icon={icon}
              orbit={orbit}
              share={(index + 0.25 * orbit.riders.length) / orbit.riders.length}
            />
          )),
        )}
      </g>
      <circle
        cx={BOARD.cx}
        cy={BOARD.cy}
        r={34}
        {...props(ink.accentFill, ink.bloom, agent.corona)}
      />
      <circle cx={BOARD.cx} cy={BOARD.cy} r={26} {...props(ink.strongAccentFill)} />
      <circle cx={BOARD.cx} cy={BOARD.cy} r={31} {...props(ink.accent, agent.halo)} />
      <Glyph name="agent" x={BOARD.cx} y={BOARD.cy} size={22} tone="inverse" />
    </Strip>
  );
}

/** The still strips, by settings page. Hub pages and Appearance draw theirs from live state. */
export const PAGE_STRIPS = {
  general: GeneralStrip,
  usage: UsageStrip,
  agent: AgentStrip,
  editor: EditorStrip,
  terminal: TerminalStrip,
  browser: BrowserStrip,
  advanced: AdvancedStrip,
} as const;

const driftA = keyframes({
  "0%, 100%": { transform: "translateY(0)" },
  "50%": { transform: "translateY(14px)" },
});

const driftB = keyframes({
  "0%, 100%": { transform: "translateY(0)" },
  "50%": { transform: "translateY(-18px)" },
});

const twinkle = keyframes({
  "0%, 100%": { opacity: 0.15, transform: "scale(0.6)" },
  "50%": { opacity: 0.9, transform: "scale(1)" },
});

const grow = keyframes({ from: { transform: "scaleY(0)" }, to: { transform: "scaleY(1)" } });

const ripple = keyframes({
  from: { transform: "scale(1)", opacity: 0.8 },
  to: { transform: "scale(4)", opacity: 0 },
});

const spinOnce = keyframes({ from: { strokeDashoffset: 0 }, to: { strokeDashoffset: -40 } });

const reduced = "@media (prefers-reduced-motion: reduce)";

const appearance = create({
  swoosh: { opacity: 0.5 },
  stroke: { fill: "none", stroke: role.chartSeries, strokeWidth: 34, opacity: 0.35 },
  bristle: { fill: "none", stroke: role.chartSeries, strokeWidth: 2, opacity: 0.4 },
  palette: { strokeWidth: 1.4 },
  shadow: { opacity: 0.12 },
  thumb: { fill: role.bgMuted },
  smear: { opacity: 0.75 },
  paint: { transitionProperty: "fill", transitionDuration: motion.durationNormal },
  gloss: { fill: role.bgBase, opacity: 0.55 },
  chosenRing: { strokeWidth: 1.4 },
  chipChosen: { stroke: role.chartSeries, strokeWidth: 2 },
  handle: { fill: role.bgMuted },
});

const general = create({
  slot: { fill: "none", stroke: role.borderStrong, strokeWidth: 3 },
  fader: {
    transformBox: "fill-box",
    animationIterationCount: "infinite",
    animationTimingFunction: motion.easeInOutStrong,
  },
  drift0: { animationName: { default: driftA, [reduced]: "none" }, animationDuration: "5s" },
  drift1: { animationName: { default: driftB, [reduced]: "none" }, animationDuration: "7s" },
  drift2: {
    animationName: { default: driftA, [reduced]: "none" },
    animationDuration: "9s",
    animationDelay: "-3s",
  },
  arc: { strokeWidth: 2.4 },
  pointer: { strokeWidth: 2 },
  trackOn: { fill: role.chartSeries, stroke: role.chartSeries, strokeWidth: 1 },
});

const usage = create({
  bar: {
    transformBox: "fill-box",
    transformOrigin: "bottom",
    animationName: { default: grow, [reduced]: "none" },
    animationDuration: "0.9s",
    animationFillMode: "backwards",
    animationTimingFunction: motion.easeOutQuint,
  },
  delay: (delay: string) => ({ animationDelay: delay }),
  window: { fill: role.bgBase, opacity: 0.5, stroke: role.borderPrimary, strokeWidth: 1 },
  line: { strokeWidth: 1.4, strokeDasharray: "3 3" },
  day: { fontSize: 8, textAnchor: "middle" },
  dot: { stroke: role.chartSeries, strokeWidth: 2 },
  ping: {
    transformBox: "fill-box",
    transformOrigin: "center",
    animationName: { default: ripple, [reduced]: "none" },
    animationDuration: "2s",
    animationIterationCount: "infinite",
  },
  tag: { fontSize: 9, textAnchor: "middle", fontVariantNumeric: "tabular-nums" },
});

const agent = create({
  twinkle: {
    transformBox: "fill-box",
    transformOrigin: "center",
    opacity: 0.4,
    animationName: { default: twinkle, [reduced]: "none" },
    animationDuration: "3s",
    animationIterationCount: "infinite",
  },
  delay: (delay: string) => ({ animationDelay: delay }),
  orbit: { strokeDasharray: "1 5" },
  corona: { opacity: 0.7 },
  halo: {
    strokeWidth: 1,
    opacity: 0.6,
    strokeDasharray: "2 4",
    animationName: { default: spinOnce, [reduced]: "none" },
    animationDuration: "6s",
    animationIterationCount: "infinite",
    animationTimingFunction: "linear",
  },
});
