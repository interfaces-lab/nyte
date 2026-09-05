export const defaults = {
  shape: "D1",
  bg: "#141a2e",
  cloud: "#bdcdf6",
  under: "#7896d2",
  eyes: "#5878b6",
  moon: "#ffe58a",
  mode: "behind",
  x: 355,
  y: 112,
  radius: 64,
  phase: 100,
  turn: -25,
  light: 315,
  depth: 18,
  round: 0,
};
export const presets = [
  ["D1 · Original", { shape: "D1", mode: "none" }],
  ["D2 · Original", { shape: "D2", mode: "none", bg: "#191e33", under: "#5879c2" }],
  ["Butter moon", { shape: "D1", moon: "#ffe58a" }],
  ["Apricot rise", { shape: "D2", moon: "#ffb998", x: 130, y: 160, radius: 74 }],
  ["Blue hour", { shape: "D1", moon: "#9db8ff", bg: "#111b39", x: 375, y: 145, phase: 35 }],
  [
    "Moon cheek",
    { shape: "D2", mode: "cheek", moon: "#e9dcff", x: 390, y: 388, radius: 38, phase: 68 },
  ],
];
const paths = {
  D1: "M-18 255 C-8 163 34 113 106 113 C151 111 196 137 216 186 C242 158 279 150 315 166 C355 183 374 224 366 278 C404 270 444 294 459 335 C477 379 452 433 410 450 C373 465 344 450 310 465 C278 479 249 506 201 512 L-18 530Z",
  D2: "M530 250 C517 202 499 164 467 144 C474 112 447 87 415 91 C392 58 341 63 320 97 C282 81 240 107 242 143 C213 139 192 164 199 191 C165 177 130 194 126 224 C105 233 99 259 114 279 C76 292 56 327 65 359 C47 391 68 430 91 443 C97 484 137 507 185 514 L530 530Z",
};
function tint(hex, amount) {
  const target = amount > 0 ? 255 : 0;
  return (
    "#" +
    hex
      .slice(1)
      .match(/../g)
      .map((v) =>
        Math.round(parseInt(v, 16) * (1 - Math.abs(amount)) + target * Math.abs(amount))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
export function render(s = defaults, id = "cloud", size = 1024) {
  s = { ...defaults, ...s };
  const d = paths[s.shape];
  const angle = (s.light * Math.PI) / 180,
    lx = Math.cos(angle),
    ly = Math.sin(angle);
  const gradient = (name, color) =>
    `<linearGradient id="${id}-${name}" x1="${0.5 + lx * 0.5}" y1="${0.5 + ly * 0.5}" x2="${0.5 - lx * 0.5}" y2="${0.5 - ly * 0.5}"><stop stop-color="${tint(color, 0.16)}"/><stop offset=".55" stop-color="${color}"/><stop offset="1" stop-color="${tint(color, -0.12)}"/></linearGradient>`;
  const wave =
    s.shape === "D1"
      ? "M-15 500 C82 508 91 424 166 431 C218 428 230 458 309 418 C355 389 362 397 393 407 C435 421 454 394 464 372 L535 535 H-15Z"
      : "M65 390 C102 466 191 478 298 430 C396 390 458 345 514 397 L535 535 H60Z";
  let moon =
    s.mode === "none"
      ? ""
      : `<g transform="translate(${s.x} ${s.y}) rotate(${s.phase >= 99 ? 0 : s.turn})"><circle r="${s.radius}" fill="url(#${id}-moonTone)" ${s.phase >= 99 ? "" : `mask="url(#${id}-phase)"`}/></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512"><defs><clipPath id="${id}-tile"><rect width="512" height="512" rx="${s.round}"/></clipPath><clipPath id="${id}-cloud"><path d="${d}"/></clipPath>${gradient("tone", s.cloud)}${gradient("underTone", s.under)}${gradient("moonTone", s.moon)}<filter id="${id}-shadow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="${-lx * s.depth * 0.45}" dy="${-ly * s.depth * 0.45}" stdDeviation="${s.depth * 0.4}" flood-color="#060c20" flood-opacity=".2"/></filter><mask id="${id}-phase"><circle r="${s.radius}" fill="white"/><circle cx="${s.radius * (0.25 + s.phase / 85)}" cy="${-s.radius * 0.19}" r="${s.radius * 0.96}" fill="${s.phase >= 99 ? "white" : "black"}"/></mask></defs><g clip-path="url(#${id}-tile)"><path fill="${s.bg}" d="M0 0H512V512H0Z"/>${s.mode === "behind" ? moon : ""}<g filter="url(#${id}-shadow)"><path d="${d}" fill="url(#${id}-tone)"/><path clip-path="url(#${id}-cloud)" d="${wave}" fill="url(#${id}-underTone)"/></g>${s.mode === "cheek" ? `<g clip-path="url(#${id}-cloud)">${moon}</g>` : ""}<g fill="none" stroke="${s.eyes}" stroke-width="13" stroke-linecap="round">${s.shape === "D1" ? '<path d="M138 316L162 317M292 326L312 329"/>' : '<path d="M245 328L269 327M379 317L399 314"/>'}</g></g></svg>`;
}
