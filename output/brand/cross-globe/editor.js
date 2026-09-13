const defaults = {
  angle: 45,
  cross: 90,
  count: 3,
  crossCount: 2,
  depth: 9,
  bevel: 2,
  shadow: 42,
  light: 225,
  width: 16,
  spread: 88,
  curve: 8,
  scale: 66,
  gloss: 24,
  edge: 52,
  seam: 6,
  weave: true,
  flip: false,
  transparent: false,
  primary: "#efd38f",
  secondary: "#c7a969",
  background: "#18191d",
};
const state = { ...defaults };
const art = document.querySelector("#art");
const sliders = [...document.querySelectorAll("input[type=range]")];
const booleans = ["weave", "flip", "transparent"];
const colors = ["primary", "secondary", "background"];
let pending = false,
  previewTimer = 0,
  drag = null;
try {
  const value = JSON.parse(localStorage.getItem("nyte-cross-globe-relief-v2") || "null");
  if (value && typeof value === "object") {
    for (const input of sliders) {
      const n = value[input.id];
      if (typeof n === "number" && Number.isFinite(n)) {
        const step = Number(input.step);
        state[input.id] =
          Math.round(Math.min(Number(input.max), Math.max(Number(input.min), n)) / step) * step;
      }
    }
    for (const key of booleans) if (typeof value[key] === "boolean") state[key] = value[key];
    for (const key of colors)
      if (typeof value[key] === "string" && /^#[0-9a-f]{6}$/i.test(value[key]))
        state[key] = value[key];
  }
} catch {}
function hexMix(color, target, amount) {
  const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  return (
    "#" +
    rgb
      .map((v, i) =>
        Math.round(v + (target[i] - v) * amount)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
function round(value) {
  return Math.round(value * 100) / 100;
}
function bandPath(index, rotation, count) {
  const radius = (512 * state.scale) / 100,
    half = radius * 1.5;
  const position =
    count === 1 ? 0 : ((((index / (count - 1)) * 2 - 1) * radius * state.spread) / 100) * 0.73;
  const thickness = (radius * 2 * state.width) / 100;
  const bend = state.curve / 100;
  const end = position * (1 - bend * 2.25),
    control = 2 * position - end;
  const h = thickness / 2;
  const radians = (rotation * Math.PI) / 180;
  const cosine = Math.cos(radians),
    sine = Math.sin(radians);
  // Bake rotation into geometry so every face shares the same world-space light.
  function point(x, y) {
    return `${round(512 + x * cosine - y * sine)} ${round(512 + x * sine + y * cosine)}`;
  }
  const path = `M${point(-half, end - h)}Q${point(0, control - h)} ${point(half, end - h)}L${point(half, end + h)}Q${point(0, control + h)} ${point(-half, end + h)}Z`;
  return `<path d="${path}"/>`;
}
function makeSvg(transparent = state.transparent) {
  const radius = (512 * state.scale) / 100;
  const counts = [state.count, state.crossCount];
  const angle = (state.light * Math.PI) / 180;
  const lx = Math.cos(angle),
    ly = Math.sin(angle);
  const shadowX = round(-lx * (state.depth + 8)),
    shadowY = round(-ly * (state.depth + 8));
  const extrudeX = round(-lx * state.depth),
    extrudeY = round(-ly * state.depth);
  const gloss = state.gloss / 100;
  const definitions = [
    `<clipPath id="globe"><circle cx="512" cy="512" r="${round(radius)}"/></clipPath>`,
    `<linearGradient id="tile" gradientUnits="userSpaceOnUse" x1="${512 + lx * 650}" y1="${512 + ly * 650}" x2="${512 - lx * 650}" y2="${512 - ly * 650}"><stop stop-color="${hexMix(state.background, [255, 255, 255], 0.055)}"/><stop offset="1" stop-color="${hexMix(state.background, [0, 0, 0], 0.38)}"/></linearGradient>`,
    `<filter id="cast-shadow" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceAlpha" stdDeviation="${3 + state.depth * 0.45}" result="blur"/><feOffset in="blur" dx="${shadowX}" dy="${shadowY}" result="shift"/><feFlood flood-color="#000000" flood-opacity="${state.shadow / 100}" result="ink"/><feComposite in="ink" in2="shift" operator="in"/></filter>`,
    `<filter id="side" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB"><feFlood flood-color="${hexMix(state.secondary, [0, 0, 0], 0.68)}"/><feComposite in2="SourceAlpha" operator="in"/></filter>`,
  ];
  for (let f = 0; f < 2; f++)
    for (let i = 0; i < counts[f]; i++) {
      const shape = bandPath(i, state.angle + f * state.cross, counts[f]);
      definitions.push(`<path id="band-${f}-${i}" ${shape.slice(6, -2)}/>`);
    }
  for (const [family, color] of [
    [0, state.primary],
    [1, state.secondary],
  ]) {
    definitions.push(
      `<linearGradient id="material-${family}" gradientUnits="userSpaceOnUse" x1="${512 + lx * radius}" y1="${512 + ly * radius}" x2="${512 - lx * radius}" y2="${512 - ly * radius}"><stop stop-color="${hexMix(color, [255, 255, 255], 0.12 + gloss * 0.38)}"/><stop offset=".36" stop-color="${hexMix(color, [255, 255, 255], gloss * 0.12)}"/><stop offset="1" stop-color="${hexMix(color, [0, 0, 0], 0.12 + gloss * 0.16)}"/></linearGradient>`,
    );
  }
  definitions.push(
    `<radialGradient id="reflection" gradientUnits="userSpaceOnUse" cx="${512 + lx * radius * 0.6}" cy="${512 + ly * radius * 0.6}" r="${radius * 1.15}"><stop stop-color="#ffffff" stop-opacity="${gloss * 0.24}"/><stop offset=".7" stop-color="#ffffff" stop-opacity="0"/></radialGradient>`,
  );
  // The bevel comes from the final silhouette, including clipped circular edges and cutouts.
  const bx = round(-lx * state.bevel),
    by = round(-ly * state.bevel);
  definitions.push(
    `<filter id="relief-bevel" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB"><feOffset in="SourceAlpha" dx="${bx}" dy="${by}" result="down"/><feComposite in="SourceAlpha" in2="down" operator="out" result="top-edge"/><feFlood flood-color="#fff9e8" flood-opacity="${state.edge / 100}" result="light"/><feComposite in="light" in2="top-edge" operator="in" result="lit-edge"/><feOffset in="SourceAlpha" dx="${-bx}" dy="${-by}" result="up"/><feComposite in="SourceAlpha" in2="up" operator="out" result="bottom-edge"/><feFlood flood-color="#030405" flood-opacity="${(state.edge / 100) * 0.6}" result="dark"/><feComposite in="dark" in2="bottom-edge" operator="in" result="dark-edge"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="dark-edge"/><feMergeNode in="lit-edge"/></feMerge></filter>`,
  );
  function bAbove(i, j) {
    return state.weave ? (i + j + (state.flip ? 1 : 0)) % 2 === 0 : state.flip;
  }
  // Cut the lower ribbon out at each crossing. The gaps are genuinely transparent.
  for (let family = 0; family < 2; family++)
    for (let index = 0; index < counts[family]; index++) {
      let cuts = "";
      for (let other = 0; other < counts[1 - family]; other++) {
        const upper = family === 0 ? bAbove(index, other) : !bAbove(other, index);
        if (upper)
          cuts += `<use href="#band-${1 - family}-${other}" fill="black" stroke="black" stroke-width="${state.seam * 2}" stroke-linejoin="round"/>`;
      }
      definitions.push(
        `<mask id="weave-${family}-${index}" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024"><path d="M0 0H1024V1024H0Z" fill="white"/>${cuts}</mask>`,
      );
    }
  let faces = "";
  for (let family = 0; family < 2; family++)
    for (let index = 0; index < counts[family]; index++)
      faces += `<g mask="url(#weave-${family}-${index})"><use href="#band-${family}-${index}" fill="url(#material-${family})"/><use href="#band-${family}-${index}" fill="url(#reflection)"/></g>`;
  definitions.push(`<g id="emblem" clip-path="url(#globe)">${faces}</g>`);
  const background = transparent ? "" : `<path d="M0 0H1024V1024H0Z" fill="url(#tile)"/>`;
  const shadow = state.shadow > 0 ? '<use href="#emblem" filter="url(#cast-shadow)"/>' : "";
  const side =
    state.depth > 0
      ? `<g filter="url(#side)"><use href="#emblem" transform="translate(${extrudeX} ${extrudeY})"/></g>`
      : "";
  return `<title>Nyte cross globe relief</title><defs>${definitions.join("")}</defs>${background}${shadow}${side}<use href="#emblem" filter="url(#relief-bevel)"/>`;
}
function serialize(content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${content}</svg>`;
}
function sync() {
  for (const input of sliders) {
    input.value = String(state[input.id]);
    document.querySelector("#out-" + input.id).value = input.value + input.dataset.unit;
  }
  for (const key of colors) document.querySelector("#" + key).value = state[key];
  for (const key of booleans) document.querySelector("#" + key).checked = state[key];
  document.querySelector("#status").textContent =
    `${state.angle}° / ${state.count} × ${state.crossCount} BANDS`;
  document.querySelector(".icon").style.background = state.background;
}
function save() {
  try {
    localStorage.setItem("nyte-cross-globe-relief-v2", JSON.stringify(state));
  } catch {}
}
function paint() {
  pending = false;
  art.innerHTML = makeSvg();
  art.dataset.rendered = "true";
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    const uri = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(serialize(makeSvg()));
    for (const img of document.querySelectorAll(".reduction img")) img.src = uri;
  }, 110);
}
function requestPaint() {
  if (!pending) {
    pending = true;
    requestAnimationFrame(paint);
  }
}
function changed() {
  sync();
  save();
  for (const button of document.querySelectorAll("[data-preset]"))
    button.setAttribute("aria-pressed", "false");
  requestPaint();
}
for (const input of sliders)
  input.addEventListener("input", () => {
    const value = Number(input.value);
    if (!Number.isFinite(value)) return;
    state[input.id] = Math.max(Number(input.min), Math.min(Number(input.max), value));
    changed();
  });
for (const key of colors)
  document.querySelector("#" + key).addEventListener("input", (event) => {
    const color = event.target.value;
    if (!/^#[0-9a-f]{6}$/i.test(color)) return;
    state[key] = color;
    changed();
  });
for (const key of booleans)
  document.querySelector("#" + key).addEventListener("change", (event) => {
    state[key] = event.target.checked;
    changed();
  });
for (const button of document.querySelectorAll("[data-preset]"))
  button.addEventListener("click", () => {
    Object.assign(state, defaults);
    if (button.dataset.preset === "glass")
      Object.assign(state, {
        primary: "#f6cb3a",
        secondary: "#242830",
        gloss: 68,
        edge: 55,
        depth: 5,
        bevel: 3,
        shadow: 35,
        curve: 15,
      });
    if (button.dataset.preset === "silver")
      Object.assign(state, { primary: "#e5e6e8", secondary: "#d1d3d7", gloss: 25, edge: 65 });
    if (button.dataset.preset === "graphic")
      Object.assign(state, {
        depth: 0,
        bevel: 0,
        shadow: 0,
        primary: "#ffda37",
        secondary: "#ffda37",
        gloss: 0,
        edge: 0,
        seam: 6,
        curve: 22,
        width: 21,
        count: 3,
      });
    if (button.dataset.preset === "open")
      Object.assign(state, {
        count: 3,
        width: 14,
        spread: 95,
        curve: 76,
        gloss: 45,
        edge: 22,
        seam: 2,
      });
    changed();
    button.setAttribute("aria-pressed", "true");
  });
document.querySelector("#reset").addEventListener("click", () => {
  Object.assign(state, defaults);
  changed();
});
for (const button of document.querySelectorAll("button[data-view]"))
  button.addEventListener("click", () => {
    document.querySelector(".work").dataset.view = button.dataset.view;
    for (const other of document.querySelectorAll("button[data-view]"))
      other.setAttribute("aria-pressed", String(other === button));
  });
document.querySelector("#export").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([serialize(makeSvg())], { type: "image/svg+xml" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "nyte-cross-globe.svg";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
art.addEventListener("pointerdown", (event) => {
  if (drag || event.button !== 0) return;
  drag = { id: event.pointerId, x: event.clientX, angle: state.angle };
  art.setPointerCapture(event.pointerId);
  art.classList.add("dragging");
  art.focus();
});
art.addEventListener("pointermove", (event) => {
  if (drag?.id !== event.pointerId) return;
  state.angle = Math.round(
    Math.max(-90, Math.min(90, drag.angle + (event.clientX - drag.x) * 0.35)),
  );
  changed();
});
function release(event) {
  if (drag?.id !== event.pointerId) return;
  drag = null;
  art.classList.remove("dragging");
}
for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
  art.addEventListener(type, release);
art.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  state.angle = Math.max(-90, Math.min(90, state.angle + (event.key === "ArrowRight" ? 1 : -1)));
  changed();
});
sync();
requestPaint();
