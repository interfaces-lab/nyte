/**
 * The Nyte mark's numbers, as the scripts that drew it set them. Everything is in cells of the icon's 8-cell
 * grid, counted from the tile's top left corner, and drawn at 16 units a cell, so the tile is 128 units across.
 */

export const cell = 16;

export const tile = 8 * cell;

export const moon = { x: 4, y: 4, r: 3 } as const;

export const light = { x: 5, y: 3, r: 2 } as const;

/** Where the top and right margin lines meet: the point the light is the moon scaled toward. */
export const corner = { x: 7, y: 1 } as const;

export const night = {
  plate: ["#232a44", "#0c1020"],
  light: "#fff9d8",
  // logo.py's colour mark: from the light's rim to the moon's far side, walked in OKLCH
  ramp: [
    "#647fcb",
    "#6a84ce",
    "#6f89d0",
    "#758ed3",
    "#7a93d6",
    "#8098d9",
    "#869ddc",
    "#8ca2de",
    "#91a7e1",
    "#97ace4",
    "#9db1e6",
    "#a3b6e9",
    "#a9bcec",
    "#afc1ee",
    "#b5c6f1",
    "#bbcbf3",
    "#c1d0f6",
  ],
} as const;

/** How dark the shadow is at the moon's edge, how many cells it reaches across the light, and the hour it is deepest. */
export const shadow = { strength: 0.55, reach: 0.4, hour: 9 } as const;

/** The flat tile's corner radius, as a share of its side. */
export const tileCorner = 0.268;

export const apart = Math.hypot(light.x - moon.x, light.y - moon.y);

/** A length in cells, in the drawing's units. */
export function units(value: number): number {
  return Number((value * cell).toFixed(3));
}

/** The moon with the light's circle taken out: one arc round the back, one along the light. */
export function crescentPath(): string {
  const ux = (light.x - moon.x) / apart;
  const uy = (light.y - moon.y) / apart;
  const reach = (apart ** 2 + moon.r ** 2 - light.r ** 2) / (2 * apart);
  const half = Math.sqrt(moon.r ** 2 - reach ** 2);
  const first = [moon.x + ux * reach + uy * half, moon.y + uy * reach - ux * half];
  const second = [moon.x + ux * reach - uy * half, moon.y + uy * reach + ux * half];
  const start = `${units(first[0])} ${units(first[1])}`;

  return `M ${start} A ${units(moon.r)} ${units(moon.r)} 0 1 0 ${units(second[0])} ${units(second[1])} A ${units(light.r)} ${units(light.r)} 0 1 1 ${start} Z`;
}

/** The moon's gradient: rings round the light's centre, from its rim to the moon's far side. */
export function rampStops(): { offset: number; color: string }[] {
  const first = light.r / (apart + moon.r);

  return night.ramp.map((color, index) => ({
    offset: first + ((1 - first) * index) / (night.ramp.length - 1),
    color,
  }));
}

/**
 * The painted shadow: the part of the light outside a circle its own size, slid `reach` cells away from the
 * edge the moon lies over, shaded from nothing to `strength` as it nears that edge.
 */
export function shadowRing() {
  const turn = (shadow.hour * 30 * Math.PI) / 180;
  const outer = light.r + shadow.reach;

  return {
    x: light.x - Math.sin(turn) * shadow.reach,
    y: light.y + Math.cos(turn) * shadow.reach,
    r: outer,
    stops: [0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => ({
      offset: (light.r + shadow.reach * t) / outer,
      opacity: shadow.strength * t ** 1.5,
    })),
  };
}

function channels(hex: string): number[] {
  return [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
}

function luminance(rgb: readonly number[]): number {
  const linear = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));

  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function ratio(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** The WCAG contrast ratio between two hex colours: 1 is no difference, 21 is black on white. */
export function contrast(a: string, b: string): number {
  return ratio(luminance(channels(a)), luminance(channels(b)));
}

/** The WCAG contrast between `against` and `ink` laid over `ground` at `opacity`, mixed in sRGB as logo.py mixes it. */
export function contrastOver(
  ink: string,
  ground: string,
  opacity: number,
  against: string,
): number {
  const groundChannels = channels(ground);

  const mixed = channels(ink).map(
    (c, index) => groundChannels[index] + (c - groundChannels[index]) * opacity,
  );

  return ratio(luminance(mixed), luminance(channels(against)));
}
