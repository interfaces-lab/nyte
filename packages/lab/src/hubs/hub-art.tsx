/**
 * The isometric hub: the scene's hub in the middle, one tile per source with
 * its logo laid on top, and a wire from each tile to a port on the hub. A wire
 * draws in from its tile as the source connects; the hub's lights fill with
 * the scene's overall progress. Colour carries state only: green once
 * connected, red when an attempt failed, neutral otherwise.
 */
import { create, keyframes, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { Icon, type IconName } from "@nyte-ai/ui/icon";
import { intent } from "@nyte-ai/ui/surface-theme";
import { motion, role } from "@nyte-ai/ui/styles/vars.stylex";
import type { HubForm, Slot } from "./scenes";

export type Link =
  | { readonly kind: "idle" }
  | { readonly kind: "working"; readonly progress: number; readonly attempt: number }
  | { readonly kind: "on" }
  | { readonly kind: "failed"; readonly progress: number; readonly message: string };

export interface ArtNode {
  readonly id: string;
  readonly icon: IconName;
  readonly slot: Slot;
  readonly link: Link;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** One slab of the hub: its top face's centre, side height, half-width, and rows of lights. */
interface Layer {
  readonly cy: number;
  readonly t: number;
  readonly w: number;
  readonly lights: number;
}

const HUB_X = 280;

/** Each form's slabs, bottom to top. */
const FORMS: Readonly<Record<HubForm, readonly [Layer, ...Layer[]]>> = {
  stack: [
    { cy: 130, t: 16, w: 64, lights: 0 },
    { cy: 114, t: 9, w: 64, lights: 1 },
    { cy: 99, t: 9, w: 64, lights: 1 },
    { cy: 82, t: 11, w: 64, lights: 0 },
  ],
  machine: [
    { cy: 140, t: 8, w: 64, lights: 0 },
    { cy: 86, t: 46, w: 54, lights: 3 },
  ],
  badge: [
    { cy: 126, t: 14, w: 64, lights: 1 },
    { cy: 104, t: 10, w: 40, lights: 0 },
  ],
};

const TILE = { w: 24, t: 7, icon: 22 } as const;

/** Lights per face on a slab 64 wide; narrower slabs carry fewer. */
const LIGHTS_PER_FACE = 7;

/** Lays a square of side `s`, centred on the origin, flat onto a 2:1 top face. */
const FLAT = Math.SQRT1_2;

const SLOTS: Readonly<Record<Slot, { readonly at: Point; readonly side: 1 | -1 }>> = {
  "north-west": { at: { x: 96, y: 56 }, side: 1 },
  "south-west": { at: { x: 100, y: 150 }, side: 1 },
  "north-east": { at: { x: 464, y: 56 }, side: -1 },
  "south-east": { at: { x: 460, y: 150 }, side: -1 },
};

function topLayer(layers: readonly [Layer, ...Layer[]]): Layer {
  return layers.at(-1) ?? layers[0];
}

/** North wires land on the top slab, south wires on the bottom one. */
function hubPort(layers: readonly [Layer, ...Layer[]], slot: Slot): Point {
  const { side } = SLOTS[slot];
  const layer = slot.startsWith("north") ? topLayer(layers) : layers[0];

  return { x: HUB_X - side * layer.w, y: layer.cy + layer.t / 2 };
}

function tilePort(slot: Slot): Point {
  const { at, side } = SLOTS[slot];

  return { x: at.x + side * TILE.w, y: at.y + TILE.t / 2 };
}

/** Two isometric legs from the tile to the hub: along (2, -1), then (2, 1), mirrored on the east. */
function wirePoints(layers: readonly [Layer, ...Layer[]], slot: Slot): readonly Point[] {
  const start = tilePort(slot);
  const end = hubPort(layers, slot);
  const side = Math.sign(end.x - start.x);
  const run = Math.abs(end.x - start.x) / 2;
  const rise = end.y - start.y;
  const up = (run - rise) / 2;

  return [start, { x: start.x + side * 2 * up, y: start.y - up }, end];
}

/** A path through `points` with each inner corner rounded by up to `radius`. */
export function rounded(points: readonly Point[], radius: number, closed: boolean): string {
  const count = points.length;
  const at = (index: number): Point => points[(index + count) % count] ?? { x: 0, y: 0 };

  const toward = (from: Point, to: Point, distance: number): Point => {
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const step = Math.min(distance, length / 2) / length;

    return { x: from.x + (to.x - from.x) * step, y: from.y + (to.y - from.y) * step };
  };

  const corners = points.map((point, index) => {
    const round = closed || (index > 0 && index < count - 1);

    return round
      ? {
          point,
          before: toward(point, at(index - 1), radius),
          after: toward(point, at(index + 1), radius),
        }
      : { point, before: point, after: point };
  });

  const segments = corners.map((corner, index) => {
    const move = index === 0 ? "M" : "L";

    return `${move}${corner.before.x},${corner.before.y} Q${corner.point.x},${corner.point.y} ${corner.after.x},${corner.after.y}`;
  });

  return `${segments.join(" ")}${closed ? " Z" : ""}`;
}

function rhombus(cx: number, cy: number, w: number): readonly Point[] {
  return [
    { x: cx, y: cy - w / 2 },
    { x: cx + w, y: cy },
    { x: cx, y: cy + w / 2 },
    { x: cx - w, y: cy },
  ];
}

function Slab({
  cx,
  cy,
  w,
  t,
  radius,
}: {
  readonly cx: number;
  readonly cy: number;
  readonly w: number;
  readonly t: number;
  readonly radius: number;
}): ReactElement {
  const h = w / 2;

  const body = [
    { x: cx - w, y: cy },
    { x: cx, y: cy + h },
    { x: cx + w, y: cy },
    { x: cx + w, y: cy + t },
    { x: cx, y: cy + h + t },
    { x: cx - w, y: cy + t },
  ];

  return (
    <g>
      <path d={rounded(body, radius, true)} {...props(styles.solid)} />
      <path d={rounded(rhombus(cx, cy, w), radius, true)} {...props(styles.solid)} />
      <path d={`M${cx},${cy + h} L${cx},${cy + h + t}`} {...props(styles.edge)} />
    </g>
  );
}

/** An icon laid flat on the top face centred at (cx, cy). */
function FlatIcon({
  name,
  cx,
  cy,
  size,
  lit,
}: {
  readonly name: IconName;
  readonly cx: number;
  readonly cy: number;
  readonly size: number;
  readonly lit: boolean;
}): ReactElement {
  return (
    <g transform={`matrix(${FLAT} ${FLAT / 2} ${-FLAT} ${FLAT / 2} ${cx} ${cy})`}>
      <foreignObject x={-size / 2} y={-size / 2} width={size} height={size}>
        <div {...props(styles.glyph, lit && styles.glyphLit)}>
          <Icon name={name} size={size} />
        </div>
      </foreignObject>
    </g>
  );
}

function lightPoints(layers: readonly Layer[]): readonly Point[] {
  return layers.flatMap((layer) => {
    const perFace = Math.round((LIGHTS_PER_FACE * layer.w) / 64);
    const h = layer.w / 2;

    return Array.from({ length: layer.lights }, (_, row) =>
      Array.from({ length: perFace * 2 }, (_, index): Point => {
        const y = layer.cy + (layer.t * (row + 1)) / (layer.lights + 1);
        const share = ((index % perFace) + 0.75) / (perFace + 0.5);

        return index < perFace
          ? { x: HUB_X - layer.w + layer.w * share, y: y + h * share }
          : { x: HUB_X + layer.w * share, y: y + h - h * share };
      }),
    ).flat();
  });
}

function Hub({
  layers,
  icon,
  progress,
  done,
}: {
  readonly layers: readonly [Layer, ...Layer[]];
  readonly icon: IconName;
  readonly progress: number;
  readonly done: boolean;
}): ReactElement {
  const top = topLayer(layers);
  const lights = lightPoints(layers);
  const lit = Math.round(progress * lights.length);

  return (
    <g>
      {layers.map((layer) => (
        <Slab key={layer.cy} cx={HUB_X} cy={layer.cy} w={layer.w} t={layer.t} radius={7} />
      ))}
      <FlatIcon name={icon} cx={HUB_X} cy={top.cy} size={top.w * 0.8} lit={done} />
      <g {...props(intent.success)}>
        {lights.map((point, index) => (
          <circle
            key={`${point.x},${point.y}`}
            cx={point.x}
            cy={point.y}
            r={index < lit ? 1.9 : 1.1}
            {...props(index < lit ? styles.lightOn : styles.lightOff)}
          />
        ))}
      </g>
    </g>
  );
}

function Tile({ node }: { readonly node: ArtNode }): ReactElement {
  const { at } = SLOTS[node.slot];

  return (
    <g {...props(node.link.kind === "working" && styles.blink)}>
      <Slab cx={at.x} cy={at.y} w={TILE.w} t={TILE.t} radius={4} />
      <FlatIcon
        name={node.icon}
        cx={at.x}
        cy={at.y}
        size={TILE.icon}
        lit={node.link.kind !== "idle"}
      />
    </g>
  );
}

/** How much of the wire is drawn, from the tile toward the hub. */
function drawnShare(link: Link): number {
  if (link.kind === "on") return 1;

  return link.kind === "idle" ? 0 : link.progress;
}

function Wire({
  layers,
  node,
}: {
  readonly layers: readonly [Layer, ...Layer[]];
  readonly node: ArtNode;
}): ReactElement {
  const d = rounded(wirePoints(layers, node.slot), 8, false);
  const drawn = drawnShare(node.link);

  return (
    <g>
      <path d={d} pathLength={1} {...props(styles.track)} />
      {drawn > 0 && (
        <path
          d={d}
          pathLength={1}
          strokeDasharray={`${drawn} 1`}
          {...props(styles.wire, node.link.kind === "working" && styles.wireWorking)}
        />
      )}
      {node.link.kind === "working" && (
        <path d={d} pathLength={1} strokeDasharray="0 0.05" {...props(styles.packets)} />
      )}
    </g>
  );
}

/** Drawn over the slabs, so each port sits on its corner rather than under it. */
function Ports({
  layers,
  node,
}: {
  readonly layers: readonly [Layer, ...Layer[]];
  readonly node: ArtNode;
}): ReactElement {
  const start = tilePort(node.slot);
  const end = hubPort(layers, node.slot);
  const { kind } = node.link;

  return (
    <g>
      <circle
        cx={start.x}
        cy={start.y}
        r={2.6}
        {...props(
          kind === "idle" ? styles.portOff : styles.portOn,
          kind === "working" && styles.portWorking,
        )}
      />
      <circle
        cx={end.x}
        cy={end.y}
        r={2.6}
        {...props(node.link.kind === "on" ? styles.portOn : styles.portOff)}
      />
    </g>
  );
}

export function HubArt({
  form,
  icon,
  nodes,
  progress,
  loading,
  focus,
}: {
  readonly form: HubForm;
  readonly icon: IconName;
  readonly nodes: readonly ArtNode[];
  /** 0 to 1 across every source: how many of the hub's lights are on. */
  readonly progress: number;
  readonly loading: boolean;
  readonly focus: string | undefined;
}): ReactElement {
  const layers = FORMS[form];

  return (
    <svg
      viewBox="40 22 480 172"
      aria-hidden="true"
      {...props(styles.art, loading && styles.loading)}
    >
      {nodes.map((node) => (
        <g key={node.id} {...props(...nodeLook(node, focus))}>
          {!loading && <Wire layers={layers} node={node} />}
          <Tile node={node} />
        </g>
      ))}
      <Hub
        layers={layers}
        icon={icon}
        progress={loading ? 0 : progress}
        done={!loading && progress === 1}
      />
      {nodes.map((node) => (
        <g key={node.id} {...props(...nodeLook(node, focus))}>
          <Ports layers={layers} node={node} />
        </g>
      ))}
    </svg>
  );
}

function nodeLook(node: ArtNode, focus: string | undefined) {
  return [
    node.link.kind === "failed" && intent.danger,
    node.link.kind === "on" && intent.success,
    styles.node,
    focus !== undefined && focus !== node.id && styles.dimmed,
  ] as const;
}

const march = keyframes({ from: { strokeDashoffset: 0 }, to: { strokeDashoffset: -0.05 } });

const pulse = keyframes({ "0%, 100%": { opacity: 1 }, "50%": { opacity: 0.45 } });

const reduced = "@media (prefers-reduced-motion: reduce)";

const styles = create({
  art: {
    display: "block",
    width: "100%",
    height: "auto",
    overflow: "visible",
    strokeLinecap: "round",
    strokeLinejoin: "round",
  },
  loading: {
    animationName: { default: pulse, [reduced]: "none" },
    animationDuration: "1.6s",
    animationIterationCount: "infinite",
    animationTimingFunction: motion.easeInOutStrong,
  },
  node: { transitionProperty: "opacity", transitionDuration: motion.durationNormal },
  dimmed: { opacity: 0.3 },
  solid: { fill: role.bgBase, stroke: role.contentTertiary, strokeWidth: 1.1 },
  edge: { fill: "none", stroke: role.contentTertiary, strokeWidth: 1.1 },
  glyph: {
    display: "flex",
    width: "100%",
    height: "100%",
    color: role.contentTertiary,
    transitionProperty: "color",
    transitionDuration: motion.durationNormal,
  },
  glyphLit: { color: role.contentPrimary },
  track: {
    fill: "none",
    stroke: role.borderPrimary,
    strokeWidth: 1,
    strokeDasharray: "0.004 0.016",
  },
  wire: {
    fill: "none",
    stroke: role.chartSeries,
    strokeWidth: 1.6,
    transitionProperty: "stroke-dasharray",
    transitionDuration: motion.durationFast,
    transitionTimingFunction: "linear",
  },
  wireWorking: { stroke: role.contentSecondary },
  packets: {
    fill: "none",
    stroke: role.contentPrimary,
    strokeWidth: 2.4,
    opacity: 0.6,
    animationName: { default: march, [reduced]: "none" },
    animationDuration: "0.9s",
    animationIterationCount: "infinite",
    animationTimingFunction: "linear",
  },
  portOn: { fill: role.chartSeries, stroke: role.chartSeries, strokeWidth: 1 },
  portWorking: { fill: role.contentSecondary, stroke: role.contentSecondary },
  portOff: { fill: role.bgBase, stroke: role.contentTertiary, strokeWidth: 1 },
  blink: {
    animationName: { default: pulse, [reduced]: "none" },
    animationDuration: "1s",
    animationIterationCount: "infinite",
  },
  lightOn: {
    fill: role.chartSeries,
    transitionProperty: "r, fill",
    transitionDuration: motion.durationNormal,
  },
  lightOff: { fill: role.borderStrong },
});
