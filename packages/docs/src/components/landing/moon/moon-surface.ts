/*
 * The near side of the moon as a baked equirectangular texture, drawn as
 * text. Baking costs one pass per feature over its own bounding box; after
 * that a frame is a few bilinear samples per cell, cheap enough for 24fps.
 *
 * Shading is Lommel–Seeliger (the moon stays bright to the limb) mixed with
 * Lambert, plus a relief term from the height field so crater rims catch
 * light on one side and drop shadow on the other near the terminator.
 */

const D = Math.PI / 180;
export const TEX_W = 720;
export const TEX_H = 360;

export const RAMP = " .'`,:;-~_+=^*!/|(){}[]?ilcvxzuno*#%&8@";

type Vec = [number, number, number];

/* lon, lat, angular radius (rad), darkness */
const MARIA: [number, number, number, number][] = [
  [-16, 33, 0.3, 0.34], // Imbrium
  [17, 28, 0.19, 0.3], // Serenitatis
  [31, 8, 0.22, 0.3], // Tranquillitatis
  [59, 17, 0.11, 0.34], // Crisium
  [51, -8, 0.15, 0.26], // Fecunditatis
  [35, -15, 0.09, 0.26], // Nectaris
  [-57, 18, 0.3, 0.28], // Procellarum
  [-45, -2, 0.26, 0.26],
  [-62, 35, 0.18, 0.24],
  [-17, -21, 0.14, 0.24], // Nubium
  [-39, -24, 0.1, 0.3], // Humorum
  [-26, -3, 0.09, 0.2], // Cognitum
  [0, 56, 0.1, 0.22], // Frigoris
  [-25, 55, 0.09, 0.22],
  [25, 56, 0.09, 0.22],
  [7, 13, 0.06, 0.2], // Vaporum
  [-93, -19, 0.08, 0.3], // Orientale
  [147, 27, 0.07, 0.3], // Moscoviense, the far side's one real mare
  [-169, -53, 0.55, 0.1], // South Pole–Aitken, a faint giant
  [-151, -36, 0.13, 0.12], // Apollo
  [-157, -4, 0.12, 0.08], // Korolev
];

export interface NamedCrater {
  name: string;
  lon: number;
  lat: number;
}

/* name, lon, lat, radius (rad), depth, ray strength, floor darkening */
const CRATERS: [string, number, number, number, number, number, number][] = [
  ["Tycho", -11, -43, 0.03, 1, 1, 0],
  ["Copernicus", -20, 10, 0.034, 1, 0.7, 0],
  ["Kepler", -38, 8, 0.012, 0.8, 0.45, 0],
  ["Aristarchus", -47, 24, 0.014, 0.8, 0.35, -0.35],
  ["Plato", -9, 51, 0.036, 0.5, 0, 0.35],
  ["Clavius", -14, -58, 0.075, 0.7, 0, 0],
  ["Theophilus", 26, -11, 0.034, 1, 0, 0],
  ["Petavius", 61, -25, 0.06, 0.8, 0, 0],
  ["Langrenus", 61, -9, 0.045, 0.9, 0, 0],
  ["Grimaldi", -68, -5, 0.055, 0.4, 0, 0.3],
  ["Ptolemaeus", -2, -9, 0.058, 0.5, 0, 0.08],
  ["Eratosthenes", -11, 15, 0.02, 1, 0, 0],
  ["Archimedes", -4, 30, 0.028, 0.6, 0, 0.1],
  ["Proclus", 47, 16, 0.01, 0.8, 0.3, -0.2],
  ["Maginus", -6, -50, 0.058, 0.6, 0, 0],
  ["Schickard", -55, -44, 0.075, 0.4, 0, 0.1],
  ["Longomontanus", -21, -50, 0.052, 0.6, 0, 0],
  ["Alphonsus", -3, -13, 0.04, 0.6, 0, 0],
  ["Tsiolkovskiy", 129, -21, 0.052, 0.9, 0, 0.32],
  ["Hertzsprung", -129, 2, 0.1, 0.4, 0, 0],
  ["Giordano Bruno", 103, 36, 0.008, 0.9, 0.6, -0.3],
  ["Jackson", -163, 22, 0.02, 1, 0.5, 0],
];

export const NAMED: NamedCrater[] = CRATERS.map(([name, lon, lat]) => ({ name, lon, lat }));

function sph(lon: number, lat: number): Vec {
  return [
    Math.cos(lat * D) * Math.sin(lon * D),
    Math.sin(lat * D),
    Math.cos(lat * D) * Math.cos(lon * D),
  ];
}

export function mulberry(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function craterProfile(t: number, depth: number) {
  if (t < 1) return depth * (-0.9 * (1 - t * t) ** 1.2 + 0.25 * t ** 6);
  return depth * (0.35 * Math.exp(-(((t - 1) / 0.12) ** 2)) + 0.05 * Math.exp(-(t - 1) / 0.6));
}

export interface Surface {
  height: Float32Array;
  albedo: Float32Array;
}

/* Visit every texel within `reach` radians of a point, with its angular distance. */
function eachTexel(
  vx: Float32Array,
  vy: Float32Array,
  vz: Float32Array,
  lon: number,
  lat: number,
  reach: number,
  visit: (index: number, distance: number, dx: number, dy: number, dz: number) => void,
) {
  const center = sph(lon, lat);
  const latSpan = reach / D;
  const lat0 = Math.max(-90, lat - latSpan);
  const lat1 = Math.min(90, lat + latSpan);
  const widest = Math.max(Math.abs(lat0), Math.abs(lat1));
  const lonSpan = widest > 85 ? 180 : Math.min(180, latSpan / Math.cos(widest * D));
  const row0 = Math.floor(((90 - lat1) / 180) * TEX_H);
  const row1 = Math.min(TEX_H - 1, Math.ceil(((90 - lat0) / 180) * TEX_H));
  const colCount = Math.ceil((lonSpan / 360) * TEX_W) * 2 + 1;
  const colStart = Math.floor(((lon - lonSpan + 180) / 360) * TEX_W);
  const cosReach = Math.cos(reach);

  for (let row = row0; row <= row1; row++) {
    for (let step = 0; step < colCount; step++) {
      const col = (((colStart + step) % TEX_W) + TEX_W) % TEX_W;
      const index = row * TEX_W + col;
      const dot = vx[index] * center[0] + vy[index] * center[1] + vz[index] * center[2];
      if (dot < cosReach) continue;
      visit(
        index,
        Math.acos(Math.min(1, dot)),
        vx[index] - center[0],
        vy[index] - center[1],
        vz[index] - center[2],
      );
    }
  }
}

export function bakeSurface(): Surface {
  const size = TEX_W * TEX_H;
  const height = new Float32Array(size);
  const albedo = new Float32Array(size).fill(1);
  const vx = new Float32Array(size);
  const vy = new Float32Array(size);
  const vz = new Float32Array(size);

  for (let row = 0; row < TEX_H; row++) {
    const lat = 90 - ((row + 0.5) / TEX_H) * 180;
    for (let col = 0; col < TEX_W; col++) {
      const [x, y, z] = sph(((col + 0.5) / TEX_W) * 360 - 180, lat);
      const index = row * TEX_W + col;
      vx[index] = x;
      vy[index] = y;
      vz[index] = z;
      height[index] =
        0.0015 * Math.sin(37 * x + 5 * y) * Math.sin(41 * y - 3 * z) +
        0.001 * Math.sin(71 * z + 13 * x);
    }
  }

  for (const [lon, lat, radius, darkness] of MARIA) {
    eachTexel(vx, vy, vz, lon, lat, radius * 1.6, (index, distance) => {
      const edge = 1 / (1 + Math.exp((distance - radius) / (radius * 0.12)));
      albedo[index] -= darkness * 1.75 * edge;
      height[index] -= 0.01 * edge;
    });
  }

  const random = mulberry(4);
  /* The far side is highland: more craters, fewer maria. */
  for (let i = 0; i < 900; i++) {
    const radius = Math.min(0.06, (0.006 / (random() ** 0.55 + 0.05)) * 0.35 + 0.004);
    const lon = random() * 360 - 180;
    const lat = Math.asin(random() * 2 - 1) / D;
    const depth = 0.4 + random() * 0.6;
    eachTexel(vx, vy, vz, lon, lat, radius * 2, (index, distance) => {
      height[index] += craterProfile(distance / radius, depth) * radius * 0.9;
    });
  }

  for (const [name, lon, lat, radius, depth, rays, floor] of CRATERS) {
    eachTexel(vx, vy, vz, lon, lat, radius * 2.5, (index, distance) => {
      height[index] += craterProfile(distance / radius, depth) * radius * 0.9;
      if (distance < radius) albedo[index] -= floor;
      if (distance < radius * 1.4) albedo[index] += 0.12 * depth;
    });
    if (!rays) continue;
    eachTexel(vx, vy, vz, lon, lat, 1.1, (index, distance, dx, dy, dz) => {
      if (distance < radius * 1.2) return;
      const theta = Math.atan2(dy, dx + dz * 0.3);
      const streak =
        Math.max(0, Math.sin(theta * 23 + name.length) * Math.sin(theta * 7 + 1.3)) ** 6;
      albedo[index] += rays * 0.3 * streak * Math.exp(-distance / (0.35 * rays + 0.05));
    });
  }

  for (let i = 0; i < size; i++) albedo[i] = Math.max(0.18, Math.min(1.25, albedo[i]));
  return { height, albedo };
}

function sample(field: Float32Array, lon: number, lat: number) {
  const u = (((((lon / D + 180) / 360) * TEX_W - 0.5) % TEX_W) + TEX_W) % TEX_W;
  const v = Math.min(TEX_H - 1.001, Math.max(0, ((90 - lat / D) / 180) * TEX_H - 0.5));
  const c0 = Math.floor(u);
  const r0 = Math.floor(v);
  const c1 = (c0 + 1) % TEX_W;
  const fu = u - c0;
  const fv = v - r0;
  const top = field[r0 * TEX_W + c0] * (1 - fu) + field[r0 * TEX_W + c1] * fu;
  const bottom = field[(r0 + 1) * TEX_W + c0] * (1 - fu) + field[(r0 + 1) * TEX_W + c1] * fu;
  return top * (1 - fv) + bottom * fv;
}

export interface View {
  /** Longitude at the centre of the disc, in degrees. Increasing turns the face right to left. */
  lonTilt: number;
  /** How far the north pole leans toward the viewer, in degrees. */
  latTilt: number;
  /** Sun direction in view space, as a longitude. 0 is full, ±180 is new. */
  sunLon: number;
}

export const MOON_COLS = 128;
export const MOON_ROWS = 77;

/*
 * The storyboard loop: phase sweeps new → full → new once every 30s, lit from
 * the left first, while the surface turns once every 60s. Both run at a
 * constant rate in one direction. The clock starts at 12s, just before full,
 * so the first frame is never a dark new moon.
 */
export const PHASE_PERIOD = 30;
export const SPIN_PERIOD = 60;
const START = 12;

export function viewAt(seconds: number): View {
  const t = seconds + START;
  return {
    sunLon: -180 + ((t / PHASE_PERIOD) % 1) * 360,
    lonTilt: ((t / SPIN_PERIOD) % 1) * 360,
    latTilt: 6,
  };
}

export function renderMoon(surface: Surface, cols: number, rows: number, view: View) {
  const sun = sph(view.sunLon, -6);
  const cy = Math.cos(view.lonTilt * D);
  const sy = Math.sin(view.lonTilt * D);
  const cx = Math.cos(view.latTilt * D);
  const sx = Math.sin(view.latTilt * D);
  const step = 1.2 / cols;

  /* Screen point on the unit sphere to texture lon/lat, through the libration. */
  const lookup = (field: Float32Array, x: number, y: number, z: number) => {
    const y1 = y * cx - z * sx;
    const z1 = y * sx + z * cx;
    const x2 = x * cy + z1 * sy;
    const z2 = -x * sy + z1 * cy;
    return sample(field, Math.atan2(x2, z2), Math.asin(Math.max(-1, Math.min(1, y1))));
  };

  const lines: string[] = [];
  for (let row = 0; row < rows; row++) {
    const y = 1 - ((row + 0.5) / rows) * 2;
    let line = "";
    for (let col = 0; col < cols; col++) {
      const x = ((col + 0.5) / cols) * 2 - 1;
      const d = x * x + y * y;
      if (d > 1) {
        line += " ";
        continue;
      }
      const z = Math.sqrt(1 - d);
      const albedo = lookup(surface.albedo, x, y, z);
      const h0 = lookup(surface.height, x, y, z);
      const zx = Math.sqrt(Math.max(0, 1 - (x + step) ** 2 - y * y));
      const zy = Math.sqrt(Math.max(0, 1 - x * x - (y + step) ** 2));
      const hx = zx > 0 ? lookup(surface.height, x + step, y, zx) : h0;
      const hy = zy > 0 ? lookup(surface.height, x, y + step, zy) : h0;

      const nx = x - ((hx - h0) / step) * 0.6;
      const ny = y - ((hy - h0) / step) * 0.6;
      const length = Math.hypot(nx, ny, z);
      const bumped = (nx * sun[0] + ny * sun[1] + z * sun[2]) / length;
      const smooth = x * sun[0] + y * sun[1] + z * sun[2];
      const mu0 = Math.max(0, bumped);

      /* Past the terminator only rims within a narrow band stay lit, like peaks catching the sunrise. */
      if (smooth < -0.12 || (smooth <= 0 && bumped <= 0.02)) {
        /* Earthshine: sparse grain that follows the albedo, so the dark side keeps its maria. */
        const hash = ((((row * 73856093) ^ (col * 19349663)) >>> 0) % 1000) / 1000;
        const glow = 0.4 * albedo * (0.4 + 0.6 * z);
        line += glow > 0.5 + hash * 0.5 ? "'" : glow > 0.1 + hash * 0.5 ? "." : " ";
        continue;
      }

      const lommel = (2 * mu0) / (mu0 + Math.max(0.15, z));
      const relief = Math.max(-0.22, Math.min(0.22, (bumped - smooth) * 3.2));
      const light = Math.max(0, (0.55 * lommel + 0.45 * mu0) * albedo + relief) * 0.9;
      const tone = 1 - Math.exp(-1.5 * light);
      line += RAMP[Math.min(RAMP.length - 1, Math.floor(tone * RAMP.length))];
    }
    lines.push(line.trimEnd());
  }
  return lines.join("\n");
}
