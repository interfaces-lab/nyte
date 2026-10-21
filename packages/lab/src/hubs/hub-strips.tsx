/**
 * Strips for the hub pages, lit by the same links as the rows below them.
 * Each source is a pad at one of four slots, joined to the page's emblem by
 * a thread: dotted while idle, drawn in from the pad while connecting with
 * packets running inward, and lit in the page's hue once connected, with
 * data still flowing. A pad's LED carries state on its own: green once
 * connected, red when the attempt failed.
 *
 * Providers is a chip with a bus of traces per provider and a core per
 * sixteenth of progress; Profile is an ID badge on a lanyard; Remote access
 * is this Mac showing the pairing code, its modules filling in as routes open.
 */
import { create, keyframes, props } from "@stylexjs/stylex";
import { useContext, type ReactElement } from "react";
import { intent } from "@nyte-ai/ui/surface-theme";
import { motion, role } from "@nyte-ai/ui/styles/vars.stylex";
import type { Tint } from "@nyte-ai/ui/surface-theme";
import { rounded, type ArtNode, type Link, type Point } from "./hub-art";
import type { Slot } from "./scenes";
import { BOARD, Falloff, Glyph, Strip, ink, seeded } from "./strip";

interface HubStripInput {
  readonly nodes: readonly ArtNode[];
  /** 0 to 1 across every source. */
  readonly progress: number;
  readonly loading: boolean;
  /** The row under the pointer; the other sources dim. */
  readonly focus: string | undefined;
}

const PAD = { half: 20, icon: 20 } as const;

const PADS: Readonly<Record<Slot, Point>> = {
  "north-west": { x: 404, y: 52 },
  "south-west": { x: 404, y: 148 },
  "north-east": { x: 796, y: 52 },
  "south-east": { x: 796, y: 148 },
};

/** Where a north-west point lands for `slot`: east mirrors x, south mirrors y. */
function place(slot: Slot, point: Point): Point {
  return {
    x: slot.endsWith("east") ? BOARD.w - point.x : point.x,
    y: slot.startsWith("south") ? BOARD.h - point.y : point.y,
  };
}

function pathThrough(points: readonly Point[], radius: number): string {
  return rounded(points, radius, false);
}

/** A cubic from the pad's inner edge to `to`, leaving and arriving level. */
function curve(slot: Slot, to: Point): string {
  const pad = PADS[slot];
  const side = slot.endsWith("east") ? -1 : 1;
  const from = { x: pad.x + side * PAD.half, y: pad.y };
  const mid = (from.x + to.x) / 2;

  return `M${from.x},${from.y} C${mid},${from.y} ${mid},${to.y} ${to.x},${to.y}`;
}

function drawnShare(link: Link): number {
  if (link.kind === "on") return 1;

  return link.kind === "idle" ? 0 : link.progress;
}

function Thread({ d, link }: { readonly d: string; readonly link: Link }): ReactElement {
  const drawn = drawnShare(link);

  return (
    <g {...props(link.kind === "failed" && intent.danger)}>
      <path d={d} pathLength={1} {...props(styles.track)} />
      {link.kind === "on" && <path d={d} {...props(styles.threadBloom, ink.bloom)} />}
      {drawn > 0 && (
        <path
          d={d}
          pathLength={1}
          strokeDasharray={`${drawn} 1`}
          {...props(styles.thread, link.kind === "working" && styles.threadWorking)}
        />
      )}
      {link.kind === "working" && (
        <path d={d} pathLength={1} strokeDasharray="0.02 0.13" {...props(styles.packets)} />
      )}
      {link.kind === "on" && (
        <path d={d} pathLength={1} strokeDasharray="0.03 0.47" {...props(styles.flow)} />
      )}
    </g>
  );
}

function Pad({ node }: { readonly node: ArtNode }): ReactElement {
  const at = PADS[node.slot];
  const { kind } = node.link;

  return (
    <g {...props(kind === "working" && styles.blink)}>
      {kind === "on" && (
        <rect
          x={at.x - PAD.half}
          y={at.y - PAD.half}
          width={PAD.half * 2}
          height={PAD.half * 2}
          rx={10}
          {...props(ink.accentFill, ink.bloom, styles.halo)}
        />
      )}
      <rect
        x={at.x - PAD.half}
        y={at.y - PAD.half}
        width={PAD.half * 2}
        height={PAD.half * 2}
        rx={10}
        {...props(ink.solid, kind === "on" && styles.padLit)}
      />
      <Glyph
        name={node.icon}
        x={at.x}
        y={at.y}
        size={PAD.icon}
        tone={kind === "idle" ? "tertiary" : "primary"}
      />
      <g
        {...props(
          kind === "on" && intent.success,
          kind === "failed" && intent.danger,
          kind === "working" && styles.blinkFast,
        )}
      >
        <circle
          cx={at.x + PAD.half - 6}
          cy={at.y - PAD.half + 6}
          r={2.4}
          {...props(
            kind === "idle" && ink.strongFill,
            kind === "working" && ink.secondaryFill,
            (kind === "on" || kind === "failed") && ink.accentFill,
          )}
        />
      </g>
    </g>
  );
}

/** One source: its thread or threads under its pad, dimmed when another row has the pointer. */
function Source({
  node,
  focus,
  threads,
}: {
  readonly node: ArtNode;
  readonly focus: string | undefined;
  readonly threads: readonly string[];
}): ReactElement {
  return (
    <g {...props(ink.fade, focus !== undefined && focus !== node.id && styles.dimmed)}>
      {threads.map((d) => (
        <Thread key={d} d={d} link={node.link} />
      ))}
      <Pad node={node} />
    </g>
  );
}

function shuffled(count: number, seed: number): readonly number[] {
  const random = seeded(seed);

  return Array.from({ length: count }, (_, index) => ({ index, key: random() }))
    .toSorted((left, right) => left.key - right.key)
    .map((entry) => entry.index);
}

/** The rank at which each cell lights, so cells fill in a scattered order as progress climbs. */
function litOrder(count: number, seed: number): readonly number[] {
  const order = shuffled(count, seed);
  const rank = Array.from({ length: count }, () => 0);

  order.forEach((cell, position) => {
    rank[cell] = position;
  });

  return rank;
}

const CHIP = { x: 544, y: 44, size: 112, pinLength: 9, pinGap: 14, pins: 7 } as const;

const DIE = { x: 568, y: 68, size: 64, cell: 12, gap: 4 } as const;

const CORE_RANK = litOrder(16, 7);

/** A pin's centre along one side: 0 to 6 from the top or left. */
function pinCentre(index: number): number {
  return BOARD.cy - ((CHIP.pins - 1) / 2) * CHIP.pinGap + index * CHIP.pinGap;
}

/** The three-trace bus from a provider's pad to its three pins, laid out for the north-west. */
function busPaths(slot: Slot): readonly string[] {
  const pad = PADS["north-west"];
  const bend = 500;

  return [0, 1, 2].map((lane) => {
    const entry = pad.y - 10 + lane * 10;
    const pin = pinCentre(lane);
    const run = bend - (pin - entry);

    const points = [
      { x: pad.x + PAD.half, y: entry },
      { x: run, y: entry },
      { x: bend, y: pin },
      { x: CHIP.x - CHIP.pinLength, y: pin },
    ].map((point) => place(slot, point));

    return pathThrough(points, 5);
  });
}

/** The pins a provider's bus lands on, by side and index. */
function pinsFor(slot: Slot): readonly number[] {
  return slot.startsWith("north") ? [0, 1, 2] : [4, 5, 6];
}

/** Background copper: traces that run in from the board's edge, jog once, and end at a via. */
const COPPER = (() => {
  const random = seeded(31);

  return Array.from({ length: 22 }, (_, index) => {
    const west = index % 2 === 0;
    const y = 12 + Math.floor(random() * 22) * 8;
    const jog = (random() > 0.5 ? 1 : -1) * 8 * (1 + Math.floor(random() * 2));
    const turn = 60 + random() * 160;
    const end = turn + 30 + random() * 90;

    const points = [
      { x: -4, y },
      { x: turn, y },
      { x: turn + Math.abs(jog), y: y + jog },
      { x: Math.min(end, 330), y: y + jog },
    ].map((point) => (west ? point : { x: BOARD.w - point.x, y: point.y }));

    return { d: pathThrough(points, 4), via: points.at(-1) ?? points[0] };
  });
})();

function Pins({ lit }: { readonly lit: ReadonlySet<string> }): ReactElement {
  const sides = ["west", "east", "north", "south"] as const;

  return (
    <g>
      {sides.flatMap((side) =>
        Array.from({ length: CHIP.pins }, (_, index) => {
          const along = pinCentre(index);
          const horizontal = side === "west" || side === "east";

          const start =
            side === "west"
              ? CHIP.x - CHIP.pinLength
              : side === "east"
                ? CHIP.x + CHIP.size
                : side === "north"
                  ? CHIP.y - CHIP.pinLength
                  : CHIP.y + CHIP.size;

          const on = lit.has(`${side}-${index}`);

          return (
            <rect
              key={`${side}-${index}`}
              x={horizontal ? start : along - 2}
              y={horizontal ? along - 2 : start}
              width={horizontal ? CHIP.pinLength : 4}
              height={horizontal ? 4 : CHIP.pinLength}
              rx={1}
              {...props(ink.solid, on && styles.pinLit)}
            />
          );
        }),
      )}
    </g>
  );
}

function ProvidersArt({ nodes, progress, focus }: HubStripInput): ReactElement {
  const falloff = useContext(Falloff);

  const lit = new Set(
    nodes
      .filter((node) => node.link.kind === "on")
      .flatMap((node) =>
        pinsFor(node.slot).map((pin) => `${node.slot.endsWith("east") ? "east" : "west"}-${pin}`),
      ),
  );

  const cores = Math.round(progress * CORE_RANK.length);

  return (
    <g>
      <g mask={`url(#${falloff})`}>
        {COPPER.map((trace) => (
          <g key={trace.d}>
            <path d={trace.d} {...props(ink.faint)} />
            <circle cx={trace.via.x} cy={trace.via.y} r={2.4} {...props(ink.solid)} />
          </g>
        ))}
      </g>
      {[1, 2, 4, 5].flatMap((index) =>
        (["north", "south"] as const).map((side) => {
          const x = pinCentre(index);

          const from =
            side === "north" ? CHIP.y - CHIP.pinLength : CHIP.y + CHIP.size + CHIP.pinLength;

          const to = side === "north" ? -4 : BOARD.h + 4;
          const jog = index < 3 ? -12 : 12;
          const mid = side === "north" ? from - 12 : from + 12;

          const points = [
            { x, y: from },
            { x, y: mid },
            { x: x + jog, y: mid + (side === "north" ? -Math.abs(jog) : Math.abs(jog)) },
            { x: x + jog, y: to },
          ];

          return <path key={`${side}-${index}`} d={pathThrough(points, 4)} {...props(ink.faint)} />;
        }),
      )}

      {nodes.map((node) => (
        <Source key={node.id} node={node} focus={focus} threads={busPaths(node.slot)} />
      ))}

      <rect
        x={CHIP.x}
        y={CHIP.y}
        width={CHIP.size}
        height={CHIP.size}
        rx={12}
        opacity={progress * 0.75}
        {...props(ink.accentFill, ink.bloom, ink.fade)}
      />
      <Pins lit={lit} />
      <rect
        x={CHIP.x}
        y={CHIP.y}
        width={CHIP.size}
        height={CHIP.size}
        rx={10}
        {...props(ink.solid)}
      />
      <rect
        x={CHIP.x + 5}
        y={CHIP.y + 5}
        width={CHIP.size - 10}
        height={CHIP.size - 10}
        rx={6}
        {...props(ink.faint)}
      />
      <text x={CHIP.x + 10} y={CHIP.y + 17} {...props(ink.mono, ink.tertiaryFill, styles.silk)}>
        NYTE·N1
      </text>
      <circle cx={CHIP.x + 12} cy={CHIP.y + CHIP.size - 12} r={2.2} {...props(ink.tertiaryFill)} />
      <rect
        x={DIE.x - 2}
        y={DIE.y - 2}
        width={DIE.size + 4}
        height={DIE.size + 4}
        rx={6}
        {...props(ink.strong)}
      />
      {CORE_RANK.map((rank, index) => {
        const column = index % 4;
        const row = Math.floor(index / 4);
        const on = rank < cores;

        return (
          <rect
            key={index}
            x={DIE.x + column * (DIE.cell + DIE.gap) + 2}
            y={DIE.y + row * (DIE.cell + DIE.gap) + 2}
            width={DIE.cell}
            height={DIE.cell}
            rx={2.5}
            {...props(on ? ink.accentFill : ink.mutedFill, styles.core, on && styles.coreOn)}
          />
        );
      })}
    </g>
  );
}

const CARD = { x: 512, y: 50, w: 176, h: 108 } as const;

const CONSTELLATION = (() => {
  const random = seeded(12);

  const stars = Array.from({ length: 44 }, (_, index) => {
    const west = index % 2 === 0;
    const x = 20 + random() * 300;

    return { x: west ? x : BOARD.w - x, y: 14 + random() * 172, big: random() > 0.84 };
  });

  const lines = stars.flatMap((star, index) =>
    stars
      .slice(index + 1)
      .filter((other) => Math.hypot(other.x - star.x, other.y - star.y) < 62)
      .map((other) => ({ from: star, to: other })),
  );

  return { stars, lines };
})();

function threadEnd(slot: Slot): Point {
  return place(slot, { x: CARD.x, y: 84 });
}

function ProfileArt({ nodes, focus }: HubStripInput): ReactElement {
  const falloff = useContext(Falloff);
  const account = nodes.find((node) => node.id === "nyte");
  const signedIn = account?.link.kind === "on";
  const clip = { x: BOARD.cx, y: 44 };

  return (
    <g>
      <g mask={`url(#${falloff})`}>
        {CONSTELLATION.lines.map(({ from, to }) => (
          <path
            key={`${from.x},${to.x}`}
            d={`M${from.x},${from.y} L${to.x},${to.y}`}
            {...props(ink.faint)}
          />
        ))}
        {CONSTELLATION.stars.map((star) =>
          star.big ? (
            <g key={`${star.x},${star.y}`}>
              <circle cx={star.x} cy={star.y} r={5} {...props(ink.solid)} />
              <circle cx={star.x} cy={star.y - 1} r={1.6} {...props(ink.tertiaryFill)} />
            </g>
          ) : (
            <circle
              key={`${star.x},${star.y}`}
              cx={star.x}
              cy={star.y}
              r={1.6}
              {...props(ink.strongFill)}
            />
          ),
        )}
      </g>

      {nodes.map((node) => (
        <Source
          key={node.id}
          node={node}
          focus={focus}
          threads={[curve(node.slot, threadEnd(node.slot))]}
        />
      ))}

      {[-1, 1].map((side) => (
        <g key={side}>
          <path
            d={`M${clip.x + side * 44},-4 L${clip.x + side * 8},${clip.y}`}
            {...props(styles.strapEdge)}
          />
          <path
            d={`M${clip.x + side * 44},-4 L${clip.x + side * 8},${clip.y}`}
            {...props(styles.strap)}
          />
        </g>
      ))}
      <rect
        x={CARD.x}
        y={CARD.y}
        width={CARD.w}
        height={CARD.h}
        rx={14}
        opacity={signedIn ? 0.6 : 0}
        {...props(ink.accentFill, ink.bloom, ink.fade)}
      />
      <rect x={CARD.x} y={CARD.y} width={CARD.w} height={CARD.h} rx={12} {...props(ink.solid)} />
      <rect x={clip.x - 12} y={clip.y - 8} width={24} height={14} rx={3} {...props(ink.solid)} />
      <rect
        x={clip.x - 9}
        y={CARD.y + 8}
        width={18}
        height={4}
        rx={2}
        {...props(ink.line, styles.slot)}
      />

      <circle cx={552} cy={108} r={24} {...props(ink.solid, signedIn && styles.avatarLit)} />
      <Glyph name="user" x={552} y={108} size={24} tone={signedIn ? "primary" : "tertiary"} />

      {signedIn ? (
        <g>
          <text x={590} y={100} {...props(ink.sans, ink.primaryFill, styles.name)}>
            Ada Halden
          </text>
          <text x={590} y={114} {...props(ink.mono, ink.tertiaryFill, styles.email)}>
            ada@halden.dev
          </text>
        </g>
      ) : (
        <g>
          <rect x={590} y={91} width={72} height={8} rx={4} {...props(ink.mutedFill)} />
          <rect x={590} y={107} width={50} height={6} rx={3} {...props(ink.mutedFill)} />
        </g>
      )}
      {nodes.map((node, index) => (
        <rect
          key={node.id}
          x={590 + index * 21}
          y={128}
          width={17}
          height={7}
          rx={3.5}
          {...props(
            node.link.kind === "on" ? ink.accentFill : ink.mutedFill,
            node.link.kind === "working" && styles.blinkFast,
            ink.fade,
          )}
        />
      ))}
      <g opacity={signedIn ? 1 : 0.4} {...props(ink.fade)}>
        <rect
          x={652}
          y={62}
          width={24}
          height={16}
          rx={3}
          {...props(ink.accentFill, styles.foil)}
        />
        {[0, 6, 12].map((offset) => (
          <path
            key={offset}
            d={`M${655 + offset},77 L${663 + offset},63`}
            {...props(styles.foilLine)}
          />
        ))}
      </g>
    </g>
  );
}

const SCREEN = { x: 536, y: 38, w: 128, h: 86 } as const;

const QR = { size: 9, module: 5, x: 577.5, y: 51 } as const;

/** The three finder squares of a QR code, and seeded modules everywhere else. */
const MODULES = (() => {
  const random = seeded(4);

  return Array.from({ length: QR.size * QR.size }, (_, index) => {
    const column = index % QR.size;
    const row = Math.floor(index / QR.size);

    const finder = [
      [0, 0],
      [6, 0],
      [0, 6],
    ].some(([x = 0, y = 0]) => column >= x && column < x + 3 && row >= y && row < y + 3);

    return { column, row, finder, set: random() > 0.45 };
  }).filter((module) => module.finder || module.set);
})();

const MODULE_RANK = litOrder(MODULES.length, 9);

function RemoteArt({ nodes, progress, focus }: HubStripInput): ReactElement {
  const falloff = useContext(Falloff);
  const serving = nodes.some((node) => node.link.kind === "on");
  const lit = Math.round(progress * MODULES.length);
  const centre = { x: BOARD.cx, y: 80 };

  return (
    <g>
      <g mask={`url(#${falloff})`}>
        {Array.from({ length: 9 }, (_, index) => (
          <circle
            key={index}
            cx={centre.x}
            cy={centre.y}
            r={120 + index * 58}
            opacity={1 - index * 0.09}
            {...props(ink.faint, index % 2 === 1 && styles.dashedRing)}
          />
        ))}
        {serving &&
          [0, 1].map((wave) => (
            <circle
              key={wave}
              cx={centre.x}
              cy={centre.y}
              r={70}
              {...props(ink.accent, styles.ping, wave === 1 && styles.pingLate)}
            />
          ))}
      </g>

      {nodes.map((node) => (
        <Source
          key={node.id}
          node={node}
          focus={focus}
          threads={[curve(node.slot, place(node.slot, { x: SCREEN.x, y: 66 }))]}
        />
      ))}

      <rect
        x={SCREEN.x}
        y={SCREEN.y}
        width={SCREEN.w}
        height={SCREEN.h}
        rx={10}
        opacity={progress * 0.7}
        {...props(ink.accentFill, ink.bloom, ink.fade)}
      />
      <path
        d={`M${BOARD.cx - 10},${SCREEN.y + SCREEN.h} L${BOARD.cx - 14},150 L${BOARD.cx + 14},150 L${BOARD.cx + 10},${SCREEN.y + SCREEN.h} Z`}
        {...props(ink.solid)}
      />
      <rect x={BOARD.cx - 32} y={149} width={64} height={6} rx={3} {...props(ink.solid)} />
      <rect
        x={SCREEN.x}
        y={SCREEN.y}
        width={SCREEN.w}
        height={SCREEN.h}
        rx={9}
        {...props(ink.solid)}
      />
      <rect
        x={SCREEN.x + 6}
        y={SCREEN.y + 6}
        width={SCREEN.w - 12}
        height={SCREEN.h - 22}
        rx={4}
        {...props(styles.screen)}
      />
      <circle cx={BOARD.cx} cy={SCREEN.y + SCREEN.h - 8} r={1.8} {...props(ink.strongFill)} />
      {MODULES.map((module, index) => {
        const on = module.finder || (MODULE_RANK[index] ?? 0) < lit;

        return (
          <rect
            key={`${module.column},${module.row}`}
            x={QR.x + module.column * QR.module + 0.5}
            y={QR.y + module.row * QR.module + 0.5}
            width={QR.module - 1}
            height={QR.module - 1}
            rx={1}
            {...props(
              module.finder ? ink.tertiaryFill : on ? ink.accentFill : ink.mutedFill,
              styles.core,
            )}
          />
        );
      })}
    </g>
  );
}

const ART = { profile: ProfileArt, providers: ProvidersArt, remote: RemoteArt } as const;

const TINTS = {
  profile: "pink",
  providers: "teal",
  remote: "blue",
} as const satisfies Readonly<Record<keyof typeof ART, Tint>>;

export function hasHubStrip(scene: string): scene is keyof typeof ART {
  return Object.hasOwn(ART, scene);
}

export function HubStrip({
  scene,
  ...input
}: HubStripInput & { readonly scene: keyof typeof ART }): ReactElement {
  const Art = ART[scene];
  const idle = input.nodes.map((node) => ({ ...node, link: { kind: "idle" } as const }));

  return (
    <Strip tint={TINTS[scene]} dim={input.loading}>
      <Art
        {...input}
        nodes={input.loading ? idle : input.nodes}
        progress={input.loading ? 0 : input.progress}
      />
    </Strip>
  );
}

const inbound = keyframes({ from: { strokeDashoffset: 0 }, to: { strokeDashoffset: -0.15 } });

const stream = keyframes({ from: { strokeDashoffset: 0 }, to: { strokeDashoffset: -0.5 } });

const pulse = keyframes({ "0%, 100%": { opacity: 1 }, "50%": { opacity: 0.45 } });

const ripple = keyframes({
  from: { transform: "scale(1)", opacity: 0.7 },
  to: { transform: "scale(8)", opacity: 0 },
});

const reduced = "@media (prefers-reduced-motion: reduce)";

const styles = create({
  dimmed: { opacity: 0.25 },
  track: {
    fill: "none",
    stroke: role.borderStrong,
    strokeWidth: 1,
    strokeDasharray: "0.004 0.014",
  },
  thread: {
    fill: "none",
    stroke: role.chartSeries,
    strokeWidth: 1.6,
    transitionProperty: "stroke-dasharray",
    transitionDuration: motion.durationFast,
    transitionTimingFunction: "linear",
  },
  threadWorking: { stroke: role.contentSecondary },
  threadBloom: { fill: "none", stroke: role.chartSeries, strokeWidth: 5, opacity: 0.55 },
  packets: {
    fill: "none",
    stroke: role.contentPrimary,
    strokeWidth: 2.6,
    animationName: { default: inbound, [reduced]: "none" },
    animationDuration: "0.8s",
    animationIterationCount: "infinite",
    animationTimingFunction: "linear",
  },
  flow: {
    fill: "none",
    stroke: role.contentPrimary,
    strokeWidth: 2.2,
    opacity: 0.7,
    animationName: { default: stream, [reduced]: "none" },
    animationDuration: "2.4s",
    animationIterationCount: "infinite",
    animationTimingFunction: "linear",
  },
  halo: { opacity: 0.55 },
  padLit: { stroke: role.chartSeries, strokeWidth: 1.6 },
  blink: {
    animationName: { default: pulse, [reduced]: "none" },
    animationDuration: "1s",
    animationIterationCount: "infinite",
  },
  blinkFast: {
    animationName: { default: pulse, [reduced]: "none" },
    animationDuration: "0.5s",
    animationIterationCount: "infinite",
  },
  pinLit: { fill: role.chartSeries, stroke: role.chartSeries },
  silk: { fontSize: 7, letterSpacing: "0.12em" },
  core: { transitionProperty: "fill", transitionDuration: motion.durationNormal },
  coreOn: { filter: `drop-shadow(0 0 3px ${role.chartSeries})` },
  strap: { fill: "none", stroke: role.bgBase, strokeWidth: 6, strokeLinecap: "butt" },
  strapEdge: {
    fill: "none",
    stroke: role.contentTertiary,
    strokeWidth: 8.2,
    strokeLinecap: "butt",
  },
  slot: { fill: role.bgMuted },
  avatarLit: { stroke: role.chartSeries, strokeWidth: 2 },
  name: { fontSize: 12, fontWeight: 600 },
  email: { fontSize: 7.5 },
  foil: { opacity: 0.35 },
  foilLine: { fill: "none", stroke: role.chartSeries, strokeWidth: 1.2 },
  screen: { fill: role.bgMuted, stroke: role.borderPrimary, strokeWidth: 1 },
  dashedRing: { strokeDasharray: "2 6" },
  ping: {
    transformBox: "view-box",
    transformOrigin: "600px 80px",
    opacity: 0,
    animationName: { default: ripple, [reduced]: "none" },
    animationDuration: "3.6s",
    animationIterationCount: "infinite",
    animationTimingFunction: motion.easeOut,
  },
  pingLate: { animationDelay: "1.8s" },
});
