import { create, keyframes, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { intent } from "@nyte-ai/ui/surface-theme";
import type { ArtNode, Link, Point } from "./hub-art";
import type { Slot } from "./scenes";
import {
  BOARD,
  Chip,
  FRAME_COUNT,
  Field,
  Frame,
  Frames,
  Glyph,
  Label,
  Strip,
  ink,
  noise,
  plot,
  seeded,
  smooth,
  spectrum,
  type Area,
  type Plot,
  type Strength,
} from "./strip";

interface HubStripInput {
  readonly nodes: readonly ArtNode[];
  readonly progress: number;
  readonly loading: boolean;
  readonly focus: string | undefined;
}

const PAD = { half: 20, icon: 18 } as const;

const PADS: Readonly<Record<Slot, Point>> = {
  "north-west": { x: 420, y: 60 },
  "south-west": { x: 420, y: 140 },
  "north-east": { x: 780, y: 60 },
  "south-east": { x: 780, y: 140 },
};

function padAreas(nodes: readonly ArtNode[]): readonly Area[] {
  return nodes.map((node) => ({
    x: PADS[node.slot].x - PAD.half,
    y: PADS[node.slot].y - PAD.half,
    w: PAD.half * 2,
    h: PAD.half * 2,
  }));
}

function Pad({
  node,
  focus,
}: {
  readonly node: ArtNode;
  readonly focus: string | undefined;
}): ReactElement {
  const at = PADS[node.slot];
  const kind = node.link.kind;

  return (
    <g
      {...props(
        ink.fade,
        focus !== undefined && focus !== node.id && styles.dimmed,
        kind === "working" && styles.blink,
      )}
    >
      <g {...props(kind === "failed" && intent.danger)}>
        <Frame
          x={at.x - PAD.half}
          y={at.y - PAD.half}
          w={PAD.half * 2}
          h={PAD.half * 2}
          tone={kind === "idle" ? "faint" : "mark"}
        />
      </g>
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
          r={2.2}
          {...props(kind === "idle" ? ink.strongFill : ink.markFill)}
        />
      </g>
    </g>
  );
}

interface Course {
  readonly y: number;
  /** How far along the link from pad to hub, 0 to 1; negative on the way in from the board's edge. */
  readonly share: number;
}

/** Where a source's stream runs at x: in from the board's edge, through its pad, on to `port`. */
function course(slot: Slot, port: Point, x: number): Course | undefined {
  const east = slot.endsWith("east");
  const pad = PADS[slot];
  const along = east ? BOARD.w - x : x;
  const padAt = east ? BOARD.w - pad.x : pad.x;
  const portAt = east ? BOARD.w - port.x : port.x;
  const edge = pad.y + (slot.startsWith("north") ? -36 : 36);

  if (along > portAt) return undefined;

  if (along < padAt) {
    return { y: edge + (pad.y - edge) * smooth(padAt - 200, padAt - PAD.half, along), share: -1 };
  }

  const share = Math.max(0, (along - padAt - PAD.half) / (portAt - padAt - PAD.half));

  return { y: pad.y + (port.y - pad.y) * smooth(0, 1, share), share };
}

/** How brightly a link runs `share` of the way from its pad to the hub. */
function linkGain(link: Link, share: number): number {
  if (link.kind === "idle") return 0.3;

  if (link.kind === "on") return 1;

  if (share > link.progress) return link.kind === "working" ? 0.22 : 0.1;

  if (link.kind === "failed") return 0.55;

  return link.progress - share < 0.1 ? 1.3 : 0.95;
}

/**
 * Every source's stream: a brush stroke that comes in faint from the board's
 * edge and, past its pad, lights toward the hub as the source connects. The
 * stream of a source other than the focused one dims.
 */
function streams(
  nodes: readonly ArtNode[],
  ports: (slot: Slot) => readonly Point[],
  focus: string | undefined,
): Strength {
  return (x, y, column, row) =>
    Math.max(
      0,
      ...nodes.flatMap((node) =>
        ports(node.slot).map((port) => {
          const at = course(node.slot, port, x);

          if (at === undefined) return 0;
          const inbound = at.share < 0;
          const off = Math.abs(y - at.y) / (inbound ? 8 : 5);

          if (off >= 1) return 0;
          const bristle = inbound && noise(row, 3) < 0.22 ? 0.55 : 1;
          const body = (1 - off * off) * bristle * (0.8 + 0.2 * noise(column, row));
          const dim = focus !== undefined && focus !== node.id ? 0.35 : 1;

          return body * dim * (inbound ? 0.42 : linkGain(node.link, at.share));
        }),
      ),
    );
}

function shuffled(count: number, seed: number): readonly number[] {
  const random = seeded(seed);

  return Array.from({ length: count }, (_, index) => ({ index, key: random() }))
    .toSorted((left, right) => left.key - right.key)
    .map((entry) => entry.index);
}

function litOrder(count: number, seed: number): readonly number[] {
  const order = shuffled(count, seed);

  return Array.from({ length: count }, (_, cell) => order.indexOf(cell));
}

const BADGE = { x: 520, y: 40, w: 160, h: 120 } as const;

const AVATAR = { x: 560, y: BOARD.cy, r: 22 } as const;

const LAMP = (() => {
  const length = Math.hypot(0.55, 0.65, 0.52);

  return { x: -0.55 / length, y: -0.65 / length, z: 0.52 / length };
})();

function portrait(scale: number): Plot {
  return plot(
    (x, y) => {
      const dx = (x - AVATAR.x) / AVATAR.r;
      const dy = (y - AVATAR.y) / AVATAR.r;
      const reach = dx * dx + dy * dy;

      if (reach > 1) return 0;
      const light = Math.max(0, dx * LAMP.x + dy * LAMP.y + Math.sqrt(1 - reach) * LAMP.z);

      return scale * (0.16 + 0.84 * light);
    },
    () => 0.2 * scale,
  );
}

const PORTRAIT = { lit: portrait(1), dim: portrait(0.22) } as const;

/** Where a name and an address go once someone signs in. */
const UNNAMED = plot(
  (_x, _y, column, row) =>
    (row === 11 && column >= 74 && column < 82) || (row === 13 && column >= 74 && column < 79)
      ? 0.25
      : 0,
  () => 0,
);

/** A sparse, quiet sky behind the streams: single cells, a few of them bright enough to glint. */
const STARS = plot(
  (_x, _y, column, row) => {
    const glow = noise(row, column);

    if (noise(column * 3 + 1, row * 7 + 2) <= 0.988) return 0;

    return glow > 0.88 ? 1 : 0.2 + 0.35 * glow;
  },
  () => 0.8,
);

function badgePorts(slot: Slot): readonly Point[] {
  return [
    {
      x: slot.endsWith("east") ? BADGE.x + BADGE.w : BADGE.x,
      y: slot.startsWith("north") ? 80 : 120,
    },
  ];
}

function ProfileStrip({ nodes, loading, focus }: HubStripInput): ReactElement {
  const signedIn = nodes.find((node) => node.id === "nyte")?.link.kind === "on";
  const links = plot(streams(nodes, badgePorts, focus), () => 0.25);

  return (
    <Strip
      prism={spectrum(340)}
      dim={loading}
      clear={[BADGE, ...padAreas(nodes)]}
      backdrop={
        <g>
          <Field plot={STARS} twinkle />
          <Field plot={links} twinkle />
        </g>
      }
    >
      <Field plot={signedIn ? PORTRAIT.lit : PORTRAIT.dim} />
      {signedIn ? (
        <g>
          <Label x={596} y={92} tone="primary" size="sm">
            Ada Halden
          </Label>
          <Label x={596} y={110} mono>
            ada@halden.dev
          </Label>
        </g>
      ) : (
        <Field plot={UNNAMED} />
      )}
      <Frame x={BADGE.x} y={BADGE.y} w={BADGE.w} h={BADGE.h} />
      <Chip
        x={BADGE.x}
        y={BADGE.y + 9}
        label={signedIn ? "Signed in" : "Guest"}
        icon="user"
        tone={signedIn ? "mark" : "idle"}
      />
      {nodes.map((node) => (
        <Pad key={node.id} node={node} focus={focus} />
      ))}
    </Strip>
  );
}

const DIE = { x: 540, y: 40, w: 120, h: 120 } as const;

/** The model picker as a grid of cells, one per model, lit in a fixed shuffle as sources connect. */
const MODELS = { column: 70, row: 8, columns: 10, rows: 9 } as const;

const MODEL_RANK = litOrder(MODELS.columns * MODELS.rows, 7);

/** Three lanes per source, a ribbon cable from its pad into the die's side. */
function busPorts(slot: Slot): readonly Point[] {
  const x = slot.endsWith("east") ? DIE.x + DIE.w : DIE.x;

  return [-16, 0, 16].map((offset) => ({ x, y: PADS[slot].y + offset }));
}

function ProvidersStrip({ nodes, progress, loading, focus }: HubStripInput): ReactElement {
  const connected = nodes.filter((node) => node.link.kind === "on").length;
  const lit = Math.round(progress * MODEL_RANK.length);
  const links = plot(streams(nodes, busPorts, focus), () => 0.25);

  const models = plot(
    (_x, _y, column, row) => {
      const across = column - MODELS.column;
      const down = row - MODELS.row;

      if (across < 0 || across >= MODELS.columns || down < 0 || down >= MODELS.rows) return 0;

      return (MODEL_RANK[down * MODELS.columns + across] ?? 0) < lit
        ? 0.8 + 0.2 * noise(column, row)
        : 0.22;
    },
    () => 0.3,
  );

  return (
    <Strip
      prism={spectrum(185)}
      dim={loading}
      clear={[DIE, ...padAreas(nodes)]}
      backdrop={<Field plot={links} twinkle />}
    >
      <Field plot={models} cells="square" twinkle />
      <Frame x={DIE.x} y={DIE.y} w={DIE.w} h={DIE.h} />
      <Chip
        x={DIE.x}
        y={DIE.y + 9}
        label={`${String(connected)} of ${String(nodes.length)} linked`}
        icon="layers"
        tone={connected > 0 ? "mark" : "idle"}
      />
      <Label x={DIE.x + DIE.w / 2} y={DIE.y + DIE.h + 13} align="middle">
        Model picker
      </Label>
      {nodes.map((node) => (
        <Pad key={node.id} node={node} focus={focus} />
      ))}
    </Strip>
  );
}

const SCREEN = { x: 540, y: 40, w: 120, h: 120 } as const;

const QR = { column: 71, row: 8, size: 9 } as const;

const MODULES = (() => {
  const random = seeded(4);

  return Array.from({ length: QR.size * QR.size }, (_, index) => {
    const column = index % QR.size;
    const row = Math.floor(index / QR.size);

    const finder = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 0, y: 6 },
    ].some(
      (corner) =>
        column >= corner.x && column < corner.x + 3 && row >= corner.y && row < corner.y + 3,
    );

    return { column, row, finder, set: random() > 0.45 };
  }).filter((module) => module.finder || module.set);
})();

const MODULE_RANK = litOrder(MODULES.length, 9);

const MODULE_INDEX = new Map(
  MODULES.map((module, index) => [`${module.column},${module.row}`, index]),
);

const RIPPLE = {
  x: SCREEN.x + SCREEN.w / 2 + 4,
  y: BOARD.cy,
  from: 76,
  to: 330,
  wave: 7.6,
} as const;

/** Rings around the screen, `phase` pixels further out than at rest. */
function ripples(scale: number, phase: number): Plot {
  return plot(
    (x, y, column, row) => {
      const reach = Math.hypot(x - RIPPLE.x, y - RIPPLE.y);

      if (reach < RIPPLE.from || reach > RIPPLE.to) return 0;
      const ring = ((1 + Math.cos((reach - phase) / RIPPLE.wave)) / 2) ** 4;
      const falloff = 1 - (reach - RIPPLE.from) / (RIPPLE.to - RIPPLE.from);

      return scale * ring * falloff * (0.75 + 0.25 * noise(column, row));
    },
    () => 0.1,
  );
}

/** While serving, the rings travel outward one wavelength a loop; otherwise they rest, faint. */
const RIPPLES = {
  serving: Array.from({ length: FRAME_COUNT }, (_, frame) =>
    ripples(1, (frame * 2 * Math.PI * RIPPLE.wave) / FRAME_COUNT),
  ),
  off: ripples(0.4, 0),
} as const;

function RemoteStrip({ nodes, progress, loading, focus }: HubStripInput): ReactElement {
  const serving = nodes.some((node) => node.link.kind === "on");
  const tunnel = nodes.some((node) => node.id === "cloudflare" && node.link.kind === "on");
  const lit = Math.round(progress * MODULES.length);

  const code = plot(
    (_x, _y, column, row) => {
      const index = MODULE_INDEX.get(`${column - QR.column},${row - QR.row}`);
      const module = index === undefined ? undefined : MODULES[index];

      if (index === undefined || module === undefined) return 0;

      if (module.finder) return 1;

      return (MODULE_RANK[index] ?? 0) < lit ? 0.75 : 0.25;
    },
    () => 0.15,
  );

  return (
    <Strip
      prism={spectrum(265)}
      dim={loading}
      clear={[SCREEN, ...padAreas(nodes)]}
      backdrop={
        serving ? <Frames plots={RIPPLES.serving} seconds={3.2} /> : <Field plot={RIPPLES.off} />
      }
    >
      <Field plot={code} cells="square" />
      <Frame x={SCREEN.x} y={SCREEN.y} w={SCREEN.w} h={SCREEN.h} />
      <Chip
        x={SCREEN.x}
        y={SCREEN.y + 9}
        label={serving ? "Serving" : "Off"}
        icon="server"
        tone={serving ? "mark" : "idle"}
      />
      {tunnel && (
        <Label x={SCREEN.x + SCREEN.w / 2} y={SCREEN.y + SCREEN.h + 13} align="middle" mono>
          nyte.halden.dev
        </Label>
      )}
      {nodes.map((node) => (
        <Pad key={node.id} node={node} focus={focus} />
      ))}
    </Strip>
  );
}

const ART = { profile: ProfileStrip, providers: ProvidersStrip, remote: RemoteStrip } as const;

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
    <Art
      {...input}
      nodes={input.loading ? idle : input.nodes}
      progress={input.loading ? 0 : input.progress}
    />
  );
}

const pulse = keyframes({ "0%, 100%": { opacity: 1 }, "50%": { opacity: 0.45 } });

const reduced = "@media (prefers-reduced-motion: reduce)";

const styles = create({
  dimmed: { opacity: 0.25 },
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
});
