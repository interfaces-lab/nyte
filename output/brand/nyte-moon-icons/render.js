const BG = "#0a0c12";
const RAMP = " .:-=+*#%@";
const matrix = viewToObject(0.3, 0.25);
const origin = mul(matrix, 0, 0, 34);
const key = mul(matrix, ...KEY),
  fill = mul(matrix, ...FILL),
  eye = mul(matrix, 0, 0, 1);
function sample(x, y) {
  const ray = norm(mul(matrix, x / 34, y / 34, -1));
  const hit = traverse(origin, ray);
  if (!hit) return null;
  const point = origin.map((v, i) => v + ray[i] * hit.t);
  const sphere = norm(point),
    face = hit.nrm;
  const sun = Math.max(
    0,
    sphere.reduce((v, n, i) => v + n * key[i], 0),
  );
  const facet = Math.max(
    0,
    face.reduce((v, n, i) => v + n * eye[i], 0),
  );
  const shine = Math.max(
    0,
    face.reduce((v, n, i) => v + n * fill[i], 0),
  );
  return {
    b: Math.min(1, 0.05 + Math.sqrt(sun) * (0.68 + 0.32 * facet) + 0.05 * shine),
    lit: sun > 0.02,
  };
}
function color(hit, solid = false) {
  const stops = hit.lit
    ? [
        [106, 64, 17],
        [255, 201, 107],
        [255, 243, 220],
      ]
    : solid
      ? [
          [26, 34, 55],
          [49, 65, 97],
          [111, 139, 185],
        ]
      : [
          [32, 40, 64],
          [74, 94, 140],
          [164, 182, 216],
        ];
  const t = Math.min(1, Math.round(hit.b * 15) / 15),
    k = t < 0.5 ? t * 2 : (t - 0.5) * 2;
  const a = stops[t < 0.5 ? 0 : 1],
    b = stops[t < 0.5 ? 1 : 2];
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(",")})`;
}
const svgStart =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">';
function makeIcon(mode, foreground = false) {
  const pieces = [svgStart];
  if (!foreground) pieces.push('<rect width="1024" height="1024" fill="#0a0c12"/>');
  const extent = mode === "ascii" ? 13 : 12.8;
  if (mode !== "ascii") {
    // Quantized rays retain the source's actual voxel silhouette and lighting.
    const n = 256,
      step = 1024 / n;
    for (let row = 0; row < n; row++) {
      let start = 0,
        previous = null;
      for (let col = 0; col <= n; col++) {
        const hit =
          col < n
            ? sample(((col + 0.5) / n - 0.5) * extent, (0.5 - (row + 0.5) / n) * extent)
            : null;
        const ink = hit ? color(hit, true) : null;
        if (ink !== previous) {
          if (previous)
            pieces.push(
              `<path shape-rendering="crispEdges" fill="${previous}" d="M${start * step} ${row * step}h${(col - start) * step}v${step}H${start * step}Z"/>`,
            );
          start = col;
          previous = ink;
        }
      }
    }
  }
  if (mode !== "solid") {
    const columns = mode === "ascii" ? 72 : 58,
      rows = mode === "ascii" ? 44 : 36,
      cw = 1024 / columns,
      ch = 1024 / rows;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < columns; x++) {
        const hit = sample(((x + 0.5) / columns - 0.5) * extent, (0.5 - (y + 0.5) / rows) * extent);
        if (!hit) continue;
        if (mode === "hybrid" && !hit.lit) continue;
        const glyph = RAMP[Math.max(1, Math.round(hit.b * 9))];
        const ink = mode === "hybrid" ? "#15151c" : color(hit);
        pieces.push(
          `<text x="${(x + 0.5) * cw}" y="${(y + 0.5) * ch}" fill="${ink}" ${mode === "hybrid" ? 'opacity="0.27"' : ""} text-anchor="middle" dominant-baseline="central" font-family="monospace" font-size="${cw * 1.5}">${glyph}</text>`,
        );
      }
  }
  pieces.push("</svg>");
  return pieces.join("");
}
for (const mode of ["ascii", "solid", "hybrid"]) {
  const svg = makeIcon(mode);
  for (const image of document.querySelectorAll(`[data-icon="${mode}"]`))
    image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  const link = document.querySelector(`[data-download="${mode}"]`);
  link.href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
}
window.moonExports = {
  ascii: makeIcon("ascii"),
  solid: makeIcon("solid"),
  hybrid: makeIcon("hybrid"),
  foreground: makeIcon("solid", true),
  background: svgStart + '<rect width="1024" height="1024" fill="#0a0c12"/></svg>',
};
