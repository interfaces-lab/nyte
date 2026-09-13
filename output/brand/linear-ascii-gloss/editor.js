const capPath =
  "M 3.519,4.1690000000000005 A 0.12,0.12 0.0 0,1 3.5140000000000002,4.006 A 6.006,6.006 0.0 1,1 11.994,12.486 A 0.12,0.12 0.0 0,1 11.831,12.481 L 3.519,4.1690000000000005";
const stripePath =
  "M 2.147,9.383 C 2.1199999999999997,9.268999999999998 2.256,9.197 2.339,9.28 L 6.720000000000001,13.66 C 6.803000000000001,13.743 6.731000000000001,13.879 6.617000000000001,13.852 A 6.02,6.02 0.0 0,1 2.147000000000001,9.382000000000001 L 2.147,9.383 M 2.0,7.627 A 0.12,0.12 0.0 0,0 2.035,7.718 L 8.282,13.965 A 0.12,0.12 0.0 0,0 8.373,14.0 Q 8.801,13.973 9.209,13.889 A 0.117,0.117 0.0 0,0 9.266,13.690999999999999 L 2.31,6.734 A 0.117,0.117 0.0 0,0 2.112,6.791 A 6.0,6.0 0.0 0,0 2.0020000000000002,7.627000000000001 L 2.0,7.627 M 2.505,5.5649999999999995 A 0.12,0.12 0.0 0,0 2.53,5.696999999999999 L 10.302999999999999,13.469999999999999 A 0.12,0.12 0.0 0,0 10.434999999999999,13.495 Q 10.756999999999998,13.350999999999999 11.057999999999998,13.173 A 0.118,0.118 0.0 0,0 11.079999999999998,12.988 L 3.012,4.92 A 0.118,0.118 0.0 0,0 2.827,4.942 Q 2.649,5.242 2.505,5.565";
const initial = {
  base: {
    x: 64,
    y: 64,
    width: 896,
    height: 896,
    rotation: 0,
    fill: "#0d1018",
    rounding: 204,
    visible: true,
  },
  logo: {
    x: 184,
    y: 184,
    width: 656,
    height: 656,
    rotation: 180,
    fill: "#455064",
    meshDensity: 84,
    meshOpen: 60,
    meshOffset: 28,
    meshSeparation: 2.5,
    specularWidth: 35,
    reflectionPosition: -28,
    stripeFill: "#ffd32b",
    depth: 0,
    bevel: 0,
    gloss: 58,
    shadow: 0,
    visible: true,
  },
  light: 315,
  aspect: true,
};
let state = structuredClone(initial),
  selected = "logo",
  drag = null,
  pending = false,
  miniTimer = 0;
const art = document.querySelector("#art"),
  artboard = document.querySelector(".artboard"),
  viewport = document.querySelector(".viewport");
const transforms = ["x", "y", "width", "height", "rotation"];
const finish = [
  "depth",
  "bevel",
  "gloss",
  "shadow",
  "rounding",
  "specularWidth",
  "reflectionPosition",
  "meshDensity",
  "meshOpen",
  "meshOffset",
  "meshSeparation",
];
try {
  const saved = JSON.parse(localStorage.getItem("nyte-layered-screen-v1") || "null");
  if (saved && typeof saved === "object") {
    for (const key of ["base", "logo"]) {
      const layer = saved[key];
      if (!layer || typeof layer !== "object") continue;
      for (const prop of [...transforms, ...finish])
        if (
          Object.hasOwn(initial[key], prop) &&
          typeof layer[prop] === "number" &&
          Number.isFinite(layer[prop])
        ) {
          const input = document.querySelector("#" + prop);
          state[key][prop] = Math.max(Number(input.min), Math.min(Number(input.max), layer[prop]));
        }
      if (typeof layer.fill === "string" && /^#[0-9a-f]{6}$/i.test(layer.fill))
        state[key].fill = layer.fill;
      if (
        key === "logo" &&
        typeof layer.stripeFill === "string" &&
        /^#[0-9a-f]{6}$/i.test(layer.stripeFill)
      )
        state.logo.stripeFill = layer.stripeFill;
      if (typeof layer.visible === "boolean") state[key].visible = layer.visible;
    }
    if (typeof saved.light === "number" && Number.isFinite(saved.light))
      state.light = Math.min(360, Math.max(0, saved.light));
    if (typeof saved.aspect === "boolean") state.aspect = saved.aspect;
  }
} catch {}
const rounded = (n) => Math.round(n * 100) / 100;
function blend(color, other, t) {
  const values = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  return (
    "#" +
    values
      .map((v, i) =>
        Math.round(v + (other[i] - v) * t)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}
function layerTransform(layer) {
  return `translate(${rounded(layer.x + layer.width / 2)} ${rounded(layer.y + layer.height / 2)}) rotate(${layer.rotation}) translate(${-layer.width / 2} ${-layer.height / 2})`;
}
function surfaceMarkup(prefix = "screen") {
  const logo = state.logo,
    pitch = 12 / logo.meshDensity;
  const hole = (pitch * logo.meshOpen) / 100,
    gap = (pitch - hole) / 2;
  const offset = (pitch * logo.meshOffset) / 100;
  const depth = (logo.meshSeparation * 12) / logo.width;
  const lightTurn = state.light - 315,
    angle = ((state.light - logo.rotation) * Math.PI) / 180;
  const dx = -Math.cos(angle) * depth,
    dy = -Math.sin(angle) * depth;
  const strength = logo.gloss / 100;
  function holeRects(shift = 0) {
    return [-1, 0, 1, 2]
      .map((row) =>
        [-1, 0, 1]
          .map((column) => {
            const x = column * pitch + gap + ((Math.abs(row) % 2) * pitch) / 2 + shift;
            const y = row * pitch + gap + shift * 0.64;
            return `<rect x="${x}" y="${y}" width="${hole}" height="${hole * 0.86}" rx="${hole * 0.16}" fill="black"/>`;
          })
          .join(""),
      )
      .join("");
  }
  const definitions = `<defs>
<clipPath id="${prefix}-cap"><path d="${capPath}"/></clipPath>
<clipPath id="${prefix}-stripes"><path d="${stripePath}"/></clipPath>
<clipPath id="${prefix}-all"><path d="${capPath} ${stripePath}"/></clipPath>
<pattern id="${prefix}-front-grid" patternUnits="userSpaceOnUse" width="${pitch}" height="${pitch * 2}"><rect width="${pitch}" height="${pitch * 2}" fill="white"/>${holeRects()}</pattern>
<pattern id="${prefix}-rear-grid" patternUnits="userSpaceOnUse" width="${pitch}" height="${pitch * 2}"><rect width="${pitch}" height="${pitch * 2}" fill="white"/>${holeRects(offset)}</pattern>
<mask id="${prefix}-front-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="16" height="16"><rect width="16" height="16" fill="url(#${prefix}-front-grid)"/></mask>
<mask id="${prefix}-rear-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="16" height="16"><rect width="16" height="16" fill="url(#${prefix}-rear-grid)"/></mask>
<linearGradient id="${prefix}-dark" gradientUnits="userSpaceOnUse" x1="12" y1="12" x2="4" y2="3" gradientTransform="rotate(${lightTurn} 8 8)"><stop stop-color="${blend(logo.fill, [171, 191, 214], 0.68)}"/><stop offset=".43" stop-color="${logo.fill}"/><stop offset="1" stop-color="${blend(logo.fill, [5, 9, 16], 0.82)}"/></linearGradient>
<linearGradient id="${prefix}-gold" gradientUnits="userSpaceOnUse" x1="9" y1="13" x2="3" y2="5" gradientTransform="rotate(${lightTurn} 8 8)"><stop stop-color="${blend(logo.stripeFill, [255, 248, 208], 0.7)}"/><stop offset=".35" stop-color="${logo.stripeFill}"/><stop offset="1" stop-color="${blend(logo.stripeFill, [94, 47, 7], 0.48)}"/></linearGradient>
<radialGradient id="${prefix}-softbox" gradientUnits="userSpaceOnUse" cx="${11 + (logo.reflectionPosition + 28) * 0.02}" cy="10.7" r="${3 + logo.specularWidth * 0.065}" gradientTransform="translate(11 10.7) rotate(-30) scale(1 .56) translate(-11 -10.7) rotate(${lightTurn} 8 8)"><stop stop-color="#f4f7ff" stop-opacity="${strength * 0.9}"/><stop offset=".3" stop-color="#c5d5ec" stop-opacity="${strength * 0.35}"/><stop offset="1" stop-color="#b9cbe7" stop-opacity="0"/></radialGradient>
<filter id="${prefix}-pore-edge" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB"><feOffset in="SourceAlpha" dx="${dx * 0.38}" dy="${dy * 0.38}" result="away"/><feComposite in="SourceAlpha" in2="away" operator="out" result="edge"/><feFlood flood-color="#f5f2dc" flood-opacity="${0.3 + strength * 0.35}" result="edge-color"/><feComposite in="edge-color" in2="edge" operator="in" result="lit"/><feOffset in="SourceAlpha" dx="${-dx * 0.38}" dy="${-dy * 0.38}" result="near"/><feComposite in="SourceAlpha" in2="near" operator="out" result="lower"/><feFlood flood-color="#030509" flood-opacity=".8" result="black"/><feComposite in="black" in2="lower" operator="in" result="shade"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="shade"/><feMergeNode in="lit"/></feMerge></filter></defs>`;
  return (
    definitions +
    `<g clip-path="url(#${prefix}-all)">
<g data-region="rear-screen" transform="translate(${dx} ${dy})" mask="url(#${prefix}-rear-cut)"><g clip-path="url(#${prefix}-cap)"><rect width="16" height="16" fill="${blend(logo.fill, [0, 0, 0], 0.45)}"/></g><g clip-path="url(#${prefix}-stripes)"><rect width="16" height="16" fill="${blend(logo.stripeFill, [43, 27, 9], 0.62)}"/></g></g>
<g data-region="front-screen" filter="url(#${prefix}-pore-edge)"><g mask="url(#${prefix}-front-cut)"><g clip-path="url(#${prefix}-cap)"><rect width="16" height="16" fill="url(#${prefix}-dark)"/></g><g clip-path="url(#${prefix}-stripes)"><rect width="16" height="16" fill="url(#${prefix}-gold)"/></g><rect width="16" height="16" fill="url(#${prefix}-softbox)"/></g></g></g>`
  );
}
function iconMarkup() {
  const logo = state.logo,
    base = state.base;
  const radians = ((state.light - logo.rotation) * Math.PI) / 180,
    lx = Math.cos(radians),
    ly = Math.sin(radians);
  const bx = rounded(-lx * logo.bevel),
    by = rounded(-ly * logo.bevel),
    depthX = rounded(-lx * logo.depth * 0.7),
    depthY = rounded(-ly * logo.depth * 0.7),
    gloss = logo.gloss / 100;
  const baseRadians = ((state.light - base.rotation) * Math.PI) / 180,
    baseLX = Math.cos(baseRadians),
    baseLY = Math.sin(baseRadians);
  const definitions = `<defs><linearGradient id="base-fill" x1="${0.5 + baseLX * 0.5}" y1="${0.5 + baseLY * 0.5}" x2="${0.5 - baseLX * 0.5}" y2="${0.5 - baseLY * 0.5}"><stop stop-color="${blend(base.fill, [255, 255, 255], 0.055)}"/><stop offset="1" stop-color="${blend(base.fill, [0, 0, 0], 0.4)}"/></linearGradient><filter id="base-shadow" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="10" stdDeviation="9" flood-opacity=".3"/></filter><filter id="logo-relief" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB"><feOffset in="SourceAlpha" dx="${depthX}" dy="${depthY}" result="extrusion"/><feFlood flood-color="${blend(logo.fill, [0, 0, 0], 0.67)}" result="side-color"/><feComposite in="side-color" in2="extrusion" operator="in" result="side"/><feGaussianBlur in="SourceAlpha" stdDeviation="${1.5 + logo.depth * 0.24}" result="blur"/><feOffset in="blur" dx="${rounded(-lx * (logo.depth + 5))}" dy="${rounded(-ly * (logo.depth + 5))}" result="shadow-shift"/><feFlood flood-color="#000000" flood-opacity="${logo.shadow / 100}" result="shadow-color"/><feComposite in="shadow-color" in2="shadow-shift" operator="in" result="shadow"/><feOffset in="SourceAlpha" dx="${bx}" dy="${by}" result="away"/><feComposite in="SourceAlpha" in2="away" operator="out" result="edge"/><feFlood flood-color="#ffffff" flood-opacity=".88" result="edge-color"/><feComposite in="edge-color" in2="edge" operator="in" result="edge-light"/><feOffset in="SourceAlpha" dx="${-bx}" dy="${-by}" result="toward"/><feComposite in="SourceAlpha" in2="toward" operator="out" result="dark-edge"/><feFlood flood-color="#111318" flood-opacity=".45" result="edge-shade"/><feComposite in="edge-shade" in2="dark-edge" operator="in" result="edge-dark"/><feMerge><feMergeNode in="shadow"/><feMergeNode in="side"/><feMergeNode in="SourceGraphic"/><feMergeNode in="edge-dark"/><feMergeNode in="edge-light"/></feMerge></filter></defs>`;
  // Keep the official path exact; apply its 2..14 source bounds to the editable layer bounds.
  const scaleX = logo.width / 12,
    scaleY = logo.height / 12;
  const baseMarkup = base.visible
    ? `<g id="icon-base" data-layer="base" transform="${layerTransform(base)}"><rect width="${base.width}" height="${base.height}" rx="${Math.min(base.rounding, base.width / 2, base.height / 2)}" fill="${base.fill}" filter="url(#base-shadow)"/></g>`
    : "";
  // Apply relief after scaling so bevel and depth remain in artboard units.
  const logoMarkup = logo.visible
    ? `<g id="linear-logo" data-layer="logo" transform="${layerTransform(logo)}"><g ${logo.depth > 0 || logo.bevel > 0 || logo.shadow > 0 ? 'filter="url(#logo-relief)"' : ""}><g transform="scale(${scaleX} ${scaleY}) translate(-2 -2)">${surfaceMarkup()}</g></g></g>`
    : "";
  return `<title>Smooth glossy icon study</title>${definitions}${baseMarkup}${logoMarkup}`;
}
function selectionMarkup() {
  if (!selected || !state[selected].visible) return "";
  const layer = state[selected],
    w = layer.width,
    h = layer.height;
  const handle = 10;
  const handles = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ];
  const corners = handles
    .map(
      ([x, y]) =>
        `<rect data-action="resize" data-hx="${x}" data-hy="${y}" x="${w / 2 + (x * w) / 2 - handle / 2}" y="${h / 2 + (y * h) / 2 - handle / 2}" width="${handle}" height="${handle}" fill="#ffffff" stroke="#438bff" stroke-width="2" style="cursor:${x === y ? "nwse" : "nesw"}-resize"/>`,
    )
    .join("");
  return `<g id="selection" transform="${layerTransform(layer)}"><rect data-action="move" width="${w}" height="${h}" fill="transparent" stroke="#438bff" stroke-width="2" style="cursor:move"/><path d="M${w / 2} 0V-34" stroke="#438bff" stroke-width="2" pointer-events="none"/><circle data-action="rotate" cx="${w / 2}" cy="-40" r="8" fill="#ffffff" stroke="#438bff" stroke-width="2" style="cursor:grab"/>${corners}</g>`;
}
function serialize(markup) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">${markup}</svg>`;
}
function save() {
  try {
    localStorage.setItem("nyte-layered-screen-v1", JSON.stringify(state));
  } catch {}
}
function sync() {
  document.querySelector(".empty").classList.toggle("hidden", selected !== null);
  document.querySelector(".selected-properties").classList.toggle("hidden", selected === null);
  for (const button of document.querySelectorAll("button[data-layer]"))
    button.setAttribute("aria-pressed", String(button.dataset.layer === selected));
  if (!selected) {
    document.querySelector("#status").textContent = "No selection";
    return;
  }
  const layer = state[selected];
  document.querySelector("#selected-name").textContent =
    selected === "logo" ? "Emblem" : "Icon base";
  document.querySelector(".hint").textContent =
    selected === "logo"
      ? "Fine front pores, an offset rear screen, and shallow depth."
      : "One rounded shape beneath the logo.";
  for (const key of transforms)
    document.querySelector("#" + key).value = String(rounded(layer[key]));
  for (const key of finish)
    if (Object.hasOwn(layer, key)) {
      document.querySelector("#" + key).value = String(layer[key]);
      document.querySelector("#out-" + key).value =
        layer[key] + document.querySelector("#" + key).dataset.unit;
    }
  if (selected === "logo") {
    document.querySelector("#stripe-fill").value = state.logo.stripeFill;
    document.querySelector("#stripe-fill-code").textContent = state.logo.stripeFill;
  }
  document.querySelector("#fill").value = layer.fill;
  document.querySelector("#fill-code").textContent = layer.fill;
  document.querySelector("#aspect").checked = state.aspect;
  document.querySelector("#visible").checked = layer.visible;
  document.querySelector("#light").value = String(state.light);
  document.querySelector("#out-light").value = state.light + "°";
  document.querySelector(".logo-properties").classList.toggle("hidden", selected !== "logo");
  document.querySelector(".base-properties").classList.toggle("hidden", selected !== "base");
  document.querySelector("#status").textContent =
    `${selected === "logo" ? "Emblem" : "Icon base"} · ${Math.round(layer.width)} × ${Math.round(layer.height)} · ${rounded(layer.rotation)}°`;
}
function paint() {
  pending = false;
  art.innerHTML = iconMarkup() + selectionMarkup();
  art.dataset.ready = "true";
  clearTimeout(miniTimer);
  miniTimer = setTimeout(() => {
    const uri = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(serialize(iconMarkup()));
    document.querySelector("#mini32").src = uri;
    document.querySelector("#mini64").src = uri;
    const logo = state.logo;
    const offset = rotatePoint(-logo.width * 0.125, logo.height * 0.2417, logo.rotation);
    const size = Math.min(logo.width, logo.height) * 0.2;
    const detailX = logo.x + logo.width / 2 + offset.x - size / 2;
    const detailY = logo.y + logo.height / 2 + offset.y - size / 2;
    const detail = serialize(iconMarkup()).replace(
      'viewBox="0 0 1024 1024"',
      `viewBox="${detailX} ${detailY} ${size} ${size}"`,
    );
    document.querySelector("#mesh-detail").src =
      "data:image/svg+xml;charset=utf-8," + encodeURIComponent(detail);
  }, 100);
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
  requestPaint();
}
function choose(layer) {
  selected = layer;
  sync();
  requestPaint();
}
function worldPoint(event) {
  const matrix = art.getScreenCTM();
  if (!matrix) return { x: 0, y: 0 };
  return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
}
function rotatePoint(x, y, degrees) {
  const radians = (degrees * Math.PI) / 180;
  return {
    x: x * Math.cos(radians) - y * Math.sin(radians),
    y: x * Math.sin(radians) + y * Math.cos(radians),
  };
}
function rotation(degrees) {
  return ((degrees + 540) % 360) - 180;
}
art.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || drag) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const action = target.closest("[data-action]");
  const layerElement = target.closest("[data-layer]");
  if (!action) {
    if (layerElement) {
      choose(layerElement.getAttribute("data-layer"));
    } else {
      choose(null);
      return;
    }
  }
  if (!selected) return;
  const layer = structuredClone(state[selected]),
    point = worldPoint(event);
  const kind = action?.getAttribute("data-action") || "move";
  const hx = Number(action?.getAttribute("data-hx") || 1),
    hy = Number(action?.getAttribute("data-hy") || 1);
  const anchor = rotatePoint((-hx * layer.width) / 2, (-hy * layer.height) / 2, layer.rotation);
  drag = {
    id: event.pointerId,
    kind,
    start: point,
    layer,
    hx,
    hy,
    anchor: { x: layer.x + layer.width / 2 + anchor.x, y: layer.y + layer.height / 2 + anchor.y },
  };
  art.setPointerCapture(event.pointerId);
  art.focus();
  event.preventDefault();
});
art.addEventListener("pointermove", (event) => {
  if (!drag || drag.id !== event.pointerId || !selected) return;
  const point = worldPoint(event),
    layer = state[selected],
    old = drag.layer;
  if (drag.kind === "move") {
    let dx = point.x - drag.start.x,
      dy = point.y - drag.start.y;
    if (event.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    layer.x = rounded(old.x + dx);
    layer.y = rounded(old.y + dy);
  } else if (drag.kind === "rotate") {
    const cx = old.x + old.width / 2,
      cy = old.y + old.height / 2;
    const delta =
      Math.atan2(point.y - cy, point.x - cx) - Math.atan2(drag.start.y - cy, drag.start.x - cx);
    const raw = old.rotation + (delta * 180) / Math.PI;
    layer.rotation = rotation(event.shiftKey ? Math.round(raw / 15) * 15 : Math.round(raw));
  } else {
    const local = rotatePoint(point.x - drag.anchor.x, point.y - drag.anchor.y, -old.rotation);
    let width = Math.max(32, Math.min(1600, local.x * drag.hx)),
      height = Math.max(32, Math.min(1600, local.y * drag.hy));
    if (state.aspect || event.shiftKey) {
      const ratio = old.width / old.height;
      if (Math.abs(width - old.width) / old.width > Math.abs(height - old.height) / old.height)
        height = width / ratio;
      else width = height * ratio;
    }
    const center = rotatePoint((drag.hx * width) / 2, (drag.hy * height) / 2, old.rotation);
    layer.width = rounded(width);
    layer.height = rounded(height);
    layer.x = rounded(drag.anchor.x + center.x - width / 2);
    layer.y = rounded(drag.anchor.y + center.y - height / 2);
  }
  changed();
});
function release(event) {
  if (drag?.id === event.pointerId) drag = null;
}
for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
  art.addEventListener(type, release);
art.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    choose(null);
    return;
  }
  if (!selected || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  const step = event.shiftKey ? 10 : 1;
  const layer = state[selected];
  if (event.key === "ArrowLeft") layer.x -= step;
  if (event.key === "ArrowRight") layer.x += step;
  if (event.key === "ArrowUp") layer.y -= step;
  if (event.key === "ArrowDown") layer.y += step;
  changed();
});
for (const button of document.querySelectorAll("button[data-layer]"))
  button.addEventListener("click", () => choose(button.dataset.layer));
for (const key of transforms)
  document.querySelector("#" + key).addEventListener("input", (event) => {
    if (!selected) return;
    const input = event.target;
    if (input.value === "") return;
    const n = Number(input.value);
    if (!Number.isFinite(n)) return;
    const layer = state[selected],
      value = Math.min(Number(input.max), Math.max(Number(input.min), n));
    if (state.aspect && key === "width")
      layer.height = rounded((layer.height * value) / layer.width);
    if (state.aspect && key === "height")
      layer.width = rounded((layer.width * value) / layer.height);
    layer[key] = value;
    changed();
  });
for (const key of [...finish, "light"])
  document.querySelector("#" + key).addEventListener("input", (event) => {
    if (!selected) return;
    const input = event.target,
      n = Number(input.value);
    if (!Number.isFinite(n)) return;
    const value = Math.min(Number(input.max), Math.max(Number(input.min), n));
    if (key === "light") state.light = value;
    else if (Object.hasOwn(state[selected], key)) state[selected][key] = value;
    changed();
  });
document.querySelector("#fill").addEventListener("input", (event) => {
  if (selected && /^#[0-9a-f]{6}$/i.test(event.target.value)) {
    state[selected].fill = event.target.value;
    changed();
  }
});
document.querySelector("#stripe-fill").addEventListener("input", (event) => {
  if (/^#[0-9a-f]{6}$/i.test(event.target.value)) {
    state.logo.stripeFill = event.target.value;
    changed();
  }
});
document.querySelector("#aspect").addEventListener("change", (event) => {
  state.aspect = event.target.checked;
  save();
});
document.querySelector("#visible").addEventListener("change", (event) => {
  if (selected) {
    state[selected].visible = event.target.checked;
    changed();
  }
});
document.querySelector("#center").addEventListener("click", () => {
  if (selected) {
    const layer = state[selected];
    layer.x = (1024 - layer.width) / 2;
    layer.y = (1024 - layer.height) / 2;
    changed();
  }
});
document.querySelector("#reset-layer").addEventListener("click", () => {
  if (selected) {
    state[selected] = structuredClone(initial[selected]);
    changed();
  }
});
document.querySelector("#reset-all").addEventListener("click", () => {
  state = structuredClone(initial);
  selected = "logo";
  changed();
});
document.querySelector("#deselect").addEventListener("click", () => choose(null));
function download(name, svg) {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
document
  .querySelector("#export")
  .addEventListener("click", () => download("screen-mesh-icon.svg", serialize(iconMarkup())));
document
  .querySelector("#flat-export")
  .addEventListener("click", () =>
    download(
      "screen-mesh-emblem.svg",
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><g transform="rotate(${state.logo.rotation} 8 8)">${surfaceMarkup("flat")}</g></svg>`,
    ),
  );
for (const button of document.querySelectorAll("button[data-mode]"))
  button.addEventListener("click", () => {
    document.querySelector(".stage").dataset.mode = button.dataset.mode;
    for (const other of document.querySelectorAll("button[data-mode]"))
      other.setAttribute("aria-pressed", String(other === button));
  });
function fit() {
  const available = viewport.getBoundingClientRect();
  const fit = Math.max(160, Math.min(available.width - 88, available.height - 88));
  const zoom = Number(document.querySelector("#zoom").value);
  artboard.style.width = (fit * zoom) / 100 + "px";
  document.querySelector("#zoom-out").value = zoom + "%";
}
document.querySelector("#zoom").addEventListener("input", fit);
new ResizeObserver(fit).observe(viewport);
sync();
requestPaint();
