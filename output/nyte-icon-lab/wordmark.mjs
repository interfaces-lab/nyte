import { renderIcon, palettes } from "./icon.mjs";
const letters = [
  "M14 70 V28 M14 45 C14 13 59 13 59 45 V70",
  "M14 28 L34 68 M58 28 L35 81 Q29 96 15 96",
  "M22 12 V54 Q22 74 41 70 M8 30 H44",
  "M12 49 H58 C58 17 12 17 12 49 C12 78 46 78 56 66",
];
export function wordmark({ color = "#d2ddff", weight = 13, spacing = 4 } = {}) {
  let x = 0;
  const pieces = letters.map((d, i) => {
    const path = `<path d="${d}" transform="translate(${x} 0)"/>`;
    x += [76, 76, 60, 72][i] + spacing;
    return path;
  });
  return {
    width: x - spacing + 4,
    svg: `<g fill="none" stroke="${color}" stroke-width="${weight}" stroke-linecap="round" stroke-linejoin="round">${pieces.join("")}</g>`,
  };
}
export function renderLockup(settings, layout = "side", options = {}, id = "lockup") {
  const p = palettes[settings.palette] || palettes.nytetint;
  const gap = options.gap ?? 22;
  const color = options.light ? p.base : p.top;
  const bg = options.light ? "#f0f1f6" : p.base;
  const mark = wordmark({ color, weight: options.weight ?? 13, spacing: options.spacing ?? 4 });
  const w = 640,
    h = layout === "stack" ? 330 : 220;
  let art = "";
  if (layout === "side") {
    const size = 132,
      scale = 0.87,
      total = size + gap + mark.width * scale,
      x = (w - total) / 2;
    art = `<g transform="translate(${x} 44)">${renderIcon(settings, id + "-icon", size)}</g><g transform="translate(${x + size + gap} 65) scale(${scale})">${mark.svg}</g>`;
  } else if (layout === "stack") {
    art = `<g transform="translate(261 24)">${renderIcon(settings, id + "-icon", 118)}</g><g transform="translate(${(w - mark.width * 0.8) / 2} ${148 + gap * 0.45}) scale(.8)">${mark.svg}</g>`;
  } else {
    const scale = 0.85,
      total = mark.width * scale,
      x = (w - total) / 2;
    const left = x - gap - 45,
      right = x + total + gap + 45;
    art = `<path d="M${left + 27} 57 C${left - 19} 57 ${left - 19} 94 ${left} 105 C${left - 22} 118 ${left - 15} 164 ${left + 27} 164" fill="none" stroke="${color}" stroke-width="18" stroke-linecap="round"/><path d="M${right - 27} 57 C${right + 19} 57 ${right + 19} 94 ${right} 105 C${right + 22} 118 ${right + 15} 164 ${right - 27} 164" fill="none" stroke="${color}" stroke-width="18" stroke-linecap="round"/><g transform="translate(${x} 65) scale(${scale})">${mark.svg}</g>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Nyte ${layout} wordmark pairing"><rect width="640" height="${h}" rx="18" fill="${bg}"/>${art}</svg>`;
}
