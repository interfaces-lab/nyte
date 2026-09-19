export interface ScribbleParams {
  seed: number;
  steps: number;
  ds: number;
  tangles: number;
  tangleAmp: number;
  tangleWidth: number;
  calms: number;
  base: number;
  knotAt: number;
  knotWidth: number;
  curl: number;
  spin: number;
  drift: number;
  grip: number;
  sway: number;
  stretch: number;
}

export const SCRIBBLE_DEFAULTS: ScribbleParams = {
  seed: 1,
  steps: 12000,
  ds: 2.4,
  tangles: 5,
  tangleAmp: 1,
  tangleWidth: 0.09,
  calms: 2,
  base: 96,
  knotAt: 0.9,
  knotWidth: 0.03,
  curl: 0.9,
  spin: 70,
  drift: 0.24,
  grip: 0.0045,
  sway: 90,
  stretch: 1.5,
};

export const MESS_KEYS = [
  "steps",
  "tangles",
  "tangleAmp",
  "base",
  "curl",
  "knotWidth",
  "drift",
  "grip",
  "calms",
] as const;

const W = 1340;
const H = 530;

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const bump = (t: number, center: number, width: number) => Math.exp(-(((t - center) / width) ** 2));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** One dial over ink, tangle count, loop size, knot density and pile-up. */
export function messiness(m: number): Pick<ScribbleParams, (typeof MESS_KEYS)[number]> {
  const k = clamp(m, 0, 1);
  return {
    steps: Math.round(lerp(4500, 34000, k ** 1.3)),
    tangles: Math.round(lerp(2, 9, k)),
    tangleAmp: lerp(0.5, 1.45, k),
    base: lerp(165, 52, k ** 0.8),
    curl: lerp(0.55, 1.5, k),
    knotWidth: lerp(0.014, 0.058, k),
    drift: lerp(0.42, 0.12, k),
    grip: lerp(0.002, 0.009, k),
    calms: Math.round(lerp(4, 1, k)),
  };
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noise(rand: () => number) {
  const table = Array.from({ length: 512 }, () => rand() * 2 - 1);
  return (x: number) => {
    const i = Math.floor(x);
    const f = x - i;
    const s = f * f * (3 - 2 * f);
    const a = table[((i % 512) + 512) % 512];
    const b = table[(((i + 1) % 512) + 512) % 512];
    return a + (b - a) * s;
  };
}

/**
 * A pen with heading and momentum. Turbulent regions tighten its turn radius
 * and choke its forward drift, so it loops over itself where the envelope is
 * hot and runs straight where it is not. Returns points normalised to 0..1.
 */
export function scribble(params: ScribbleParams): [number, number][] {
  const p = params;
  const rand = rng(p.seed);
  const slow = noise(rand);
  const fast = noise(rand);
  const wobble = noise(rand);
  const detail = noise(rand);

  const tangles = Array.from({ length: Math.max(1, Math.round(p.tangles)) }, () => ({
    at: 0.12 + rand() * 0.66,
    width: 0.05 + rand() * p.tangleWidth,
    amp: (0.8 + rand() * 0.5) * p.tangleAmp,
  }));
  const calms = Array.from({ length: Math.max(0, Math.round(p.calms)) }, () => ({
    at: 0.2 + rand() * 0.55,
    width: 0.02 + rand() * 0.03,
  }));

  const knot = (t: number) => bump(t, p.knotAt, p.knotWidth);
  const chaos = (t: number) => {
    if (t < 0.08) return 0;
    let c = 0.22;
    for (const b of tangles) c += b.amp * bump(t, b.at, b.width);
    c += 1.6 * knot(t);
    for (const q of calms) c *= 1 - 0.85 * bump(t, q.at, q.width);
    return clamp(c * (1 - 0.85 * clamp((t - 0.965) / 0.035, 0, 1)), 0, 1);
  };

  const points: [number, number][] = [];
  let x = 0;
  let y = H / 2;
  let heading = 0;
  let anchorX = 0;
  let anchorY = H / 2;

  for (let i = 0; i <= p.steps; i++) {
    const t = Math.max(x / W, i / p.steps);
    if (t >= 1) break;
    const c = chaos(t);
    const k = knot(t);

    const curl = Math.max(Math.abs(detail(t * 90)) ** 1.2, 0.45 * c, 0.6 * k);
    const radius = lerp(300, p.base, c ** 1.2) * (1 - 0.45 * k);
    const sign = slow(t * p.spin);
    const swing = Math.sign(sign) * lerp(0.5, 1, Math.abs(sign));
    const turn = clamp(
      swing + wobble(t * 52) * 0.4 * c + fast(t * 260) * (0.35 * c + 1.1 * k),
      -1.8,
      1.8,
    );
    heading += (p.ds / radius) * turn * lerp(0.25, 2.4, curl) * p.curl;

    const lane = H / 2 + slow(t * 3.4) * p.sway;
    heading += wrap(Math.atan2(lane - y, 190) - heading) * lerp(0.06, 0.0015, c ** 0.6);

    x += Math.cos(heading) * p.ds;
    y += Math.sin(heading) * p.ds;
    x += lerp(0, p.drift, c ** 2) * (1 - 0.97 * k);

    const stray = Math.abs(y - lane);
    y += (lane - y) * (0.0015 + 0.035 * clamp((stray - 120) / 130, 0, 1));

    anchorX += (x - anchorX) * 0.004;
    anchorY += (y - anchorY) * 0.004;
    const hold = (p.grip + 0.04 * k) * c ** 1.5;
    x += (anchorX - x) * hold;
    y += (anchorY - y) * hold;

    points.push([x, y]);
  }

  return fit(points, p.stretch);
}

function fit(points: [number, number][], stretch: number): [number, number][] {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [px, py] of points) {
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  const w = Math.max(1e-6, maxX - minX);
  const h = Math.max(1e-6, maxY - minY);
  const sx = Math.min(1 / w, 1 / h);
  const sy = Math.min(1 / h, sx * stretch);
  const ox = (1 - w * sx) / 2;
  const oy = (1 - h * sy) / 2;
  return points.map(([px, py]) => [(px - minX) * sx + ox, (py - minY) * sy + oy]);
}

/** Catmull-Rom through the sampled points, as one cubic path in 0..1 space. */
export function toPath(points: [number, number][], every = 3): string {
  const p = points.filter((_, i) => i % every === 0);
  if (p.length < 2) return "";
  const at = (i: number) => p[clamp(i, 0, p.length - 1)];
  const r = (v: number) => Math.round(v * 10000) / 10000;
  let d = `M${r(p[0][0])} ${r(p[0][1])}`;
  for (let i = 0; i < p.length - 1; i++) {
    const [x0, y0] = at(i - 1);
    const [x1, y1] = at(i);
    const [x2, y2] = at(i + 1);
    const [x3, y3] = at(i + 2);
    d += `C${r(x1 + (x2 - x0) / 6)} ${r(y1 + (y2 - y0) / 6)} ${r(x2 - (x3 - x1) / 6)} ${r(y2 - (y3 - y1) / 6)} ${r(x2)} ${r(y2)}`;
  }
  return d;
}
