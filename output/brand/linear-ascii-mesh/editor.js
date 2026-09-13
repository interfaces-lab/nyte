const capPath =
  "M 3.519,4.1690000000000005 A 0.12,0.12 0.0 0,1 3.5140000000000002,4.006 A 6.006,6.006 0.0 1,1 11.994,12.486 A 0.12,0.12 0.0 0,1 11.831,12.481 L 3.519,4.1690000000000005";
const stripePath =
  "M 2.147,9.383 C 2.1199999999999997,9.268999999999998 2.256,9.197 2.339,9.28 L 6.720000000000001,13.66 C 6.803000000000001,13.743 6.731000000000001,13.879 6.617000000000001,13.852 A 6.02,6.02 0.0 0,1 2.147000000000001,9.382000000000001 L 2.147,9.383 M 2.0,7.627 A 0.12,0.12 0.0 0,0 2.035,7.718 L 8.282,13.965 A 0.12,0.12 0.0 0,0 8.373,14.0 Q 8.801,13.973 9.209,13.889 A 0.117,0.117 0.0 0,0 9.266,13.690999999999999 L 2.31,6.734 A 0.117,0.117 0.0 0,0 2.112,6.791 A 6.0,6.0 0.0 0,0 2.0020000000000002,7.627000000000001 L 2.0,7.627 M 2.505,5.5649999999999995 A 0.12,0.12 0.0 0,0 2.53,5.696999999999999 L 10.302999999999999,13.469999999999999 A 0.12,0.12 0.0 0,0 10.434999999999999,13.495 Q 10.756999999999998,13.350999999999999 11.057999999999998,13.173 A 0.118,0.118 0.0 0,0 11.079999999999998,12.988 L 3.012,4.92 A 0.118,0.118 0.0 0,0 2.827,4.942 Q 2.649,5.242 2.505,5.565";
const glyphOutlines = {
  units: 1000,
  glyphs: {
    " ": { path: "", advance: 600.0 },
    ".": {
      path: "M300 -10Q262 -10 239.5 12.0Q217 34 217 71Q217 110 239.5 133.0Q262 156 300 156Q338 156 360.5 133.0Q383 110 383 71Q383 34 360.5 12.0Q338 -10 300 -10Z",
      advance: 600.0,
    },
    ":": {
      path: "M300 410Q263 410 240.0 430.5Q217 451 217 485Q217 519 240.0 539.5Q263 560 300 560Q338 560 360.5 539.5Q383 519 383 485Q383 451 360.5 430.5Q338 410 300 410ZM300 -10Q263 -10 240.0 10.5Q217 31 217 65Q217 99 240.0 119.5Q263 140 300 140Q338 140 360.5 119.5Q383 99 383 65Q383 31 360.5 10.5Q338 -10 300 -10Z",
      advance: 600.0,
    },
    "-": { path: "M140 290V370H460V290Z", advance: 600.0 },
    "=": { path: "M85 410V490H515V410ZM85 170V250H515V170Z", advance: 600.0 },
    "+": { path: "M256 95V290H65V370H256V565H344V370H535V290H344V95Z", advance: 600.0 },
    "*": {
      path: "M181 94 109 144 163 222Q176 241 194.0 259.5Q212 278 230.5 294.5Q249 311 263 323L260 330Q241 332 217.0 334.5Q193 337 168.5 342.5Q144 348 123 355L35 387L65 470L153 438Q174 431 196.5 418.5Q219 406 240.0 392.5Q261 379 276 367L281 371Q276 390 270.0 414.5Q264 439 260.0 465.5Q256 492 256 515V610H344V515Q344 492 340.0 465.5Q336 439 330.0 414.5Q324 390 318 371L323 367Q339 379 359.5 392.5Q380 406 402.5 418.5Q425 431 446 438L535 470L565 387L476 355Q456 348 431.5 342.5Q407 337 383.0 334.5Q359 332 340 330L336 322Q351 310 369.5 293.5Q388 277 405.5 258.5Q423 240 435 222L490 144L418 94L363 172Q351 190 339.5 213.0Q328 236 318.5 259.0Q309 282 303 300H296Q290 282 280.5 259.0Q271 236 259.5 213.0Q248 190 235 172Z",
      advance: 600.0,
    },
    "#": {
      path: "M83 0 120 200H35V265H132L168 465H70V530H180L217 730H287L250 530H410L447 730H517L480 530H565V465H468L432 265H530V200H420L383 0H313L350 200H190L153 0ZM202 265H362L398 465H238Z",
      advance: 600.0,
    },
    "%": {
      path: "M14 0 512 730H586L88 0ZM445 -5Q382 -5 344.0 31.0Q306 67 306 130V195Q306 258 344.0 294.0Q382 330 445 330Q508 330 546.0 294.0Q584 258 584 195V130Q584 67 546.0 31.0Q508 -5 445 -5ZM445 64Q510 64 510 130V195Q510 262 445 262Q380 262 380 195V130Q380 64 445 64ZM155 400Q92 400 54.0 436.0Q16 472 16 535V600Q16 663 54.0 699.0Q92 735 155 735Q218 735 256.0 699.0Q294 663 294 600V535Q294 472 256.0 436.0Q218 400 155 400ZM155 468Q220 468 220 535V600Q220 667 155 667Q123 667 106.5 650.5Q90 634 90 600V535Q90 501 106.5 484.5Q123 468 155 468Z",
      advance: 600.0,
    },
    "@": {
      path: "M325 -180Q240 -180 177.0 -144.5Q114 -109 79.5 -43.5Q45 22 45 110V450Q45 540 77.5 605.0Q110 670 170.5 705.0Q231 740 315 740Q391 740 446.0 710.5Q501 681 530.5 626.0Q560 571 560 495V65H489V120H461L480 140Q480 102 451.0 78.5Q422 55 374 55Q309 55 274.5 94.5Q240 134 240 210V330Q240 406 274.5 445.5Q309 485 374 485Q422 485 451.0 461.5Q480 438 480 399L466 420H490L480 490V495Q480 552 461.0 591.0Q442 630 405.5 650.0Q369 670 315 670Q225 670 175.0 612.0Q125 554 125 450V110Q125 10 178.5 -47.5Q232 -105 325 -105H395V-180ZM400 118Q441 118 460.5 143.0Q480 168 480 220V331Q480 378 460.5 400.0Q441 422 400 422Q360 422 340.0 399.5Q320 377 320 330V210Q320 163 340.0 140.5Q360 118 400 118Z",
      advance: 600.0,
    },
  },
};
const initial = {
  base: {
    x: 64,
    y: 64,
    width: 896,
    height: 896,
    rotation: 0,
    fill: "#17181c",
    rounding: 204,
    visible: true,
  },
  logo: {
    x: 184,
    y: 184,
    width: 656,
    height: 656,
    rotation: 180,
    fill: "#e4e5e8",
    meshFill: "#ffd32b",
    meshSpacing: 0.13,
    meshWidth: 0.9,
    depth: 10,
    bevel: 2,
    gloss: 32,
    shadow: 50,
    visible: true,
  },
  light: 225,
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
const finish = ["depth", "bevel", "gloss", "shadow", "rounding", "meshSpacing", "meshWidth"];
try {
  const saved = JSON.parse(localStorage.getItem("linear-ascii-sections-v1") || "null");
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
        typeof layer.meshFill === "string" &&
        /^#[0-9a-f]{6}$/i.test(layer.meshFill)
      )
        state.logo.meshFill = layer.meshFill;
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
const stripeBoundary = new Path2D(stripePath);
const boundaryContext = document.createElement("canvas").getContext("2d");
function latticeMarkup(prefix = "mesh") {
  const logo = state.logo,
    step = logo.meshSpacing,
    lineHeight = step * 1.55;
  const ramp = " .:-=+*#%@";
  const definitions = Object.entries(glyphOutlines.glyphs)
    .filter(([char]) => char !== " ")
    .map(
      ([char, glyph]) => `<path id="${prefix}-glyph-${char.codePointAt(0)}" d="${glyph.path}"/>`,
    );
  definitions.push(`<clipPath id="${prefix}-clip"><path d="${stripePath}"/></clipPath>`);
  let glyphs = "";
  for (let row = 0; row < Math.ceil(16 / lineHeight); row++)
    for (let column = 0; column < Math.ceil(16 / step); column++) {
      const x = (column + 0.5) * step,
        y = (row + 0.5) * lineHeight;
      if (!boundaryContext.isPointInPath(stripeBoundary, x, y)) continue;
      // Evaluate the same crescent-like key light in the final, 180-degree orientation.
      const nx = (8 - x) / 6,
        ny = (y - 8) / 6,
        nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const sun = Math.max(0, nx * 0.8 + ny * 0.3 - nz * 0.3);
      const brightness = Math.min(1, 0.26 + Math.sqrt(sun) * 0.86);
      const char = ramp[Math.max(1, Math.round(brightness * 9))],
        glyph = glyphOutlines.glyphs[char];
      const scale = (step * logo.meshWidth) / glyph.advance,
        fontSize = scale * glyphOutlines.units;
      const color =
        brightness < 0.62
          ? blend(logo.meshFill, [43, 27, 8], (1 - brightness / 0.62) * 0.72)
          : blend(logo.meshFill, [255, 243, 211], ((brightness - 0.62) / 0.38) * 0.7);
      // Counter-rotate each glyph before the emblem's 180-degree turn, keeping its text upright.
      glyphs += `<use href="#${prefix}-glyph-${char.codePointAt(0)}" fill="${color}" transform="translate(${x + (glyph.advance * scale) / 2} ${y - fontSize * 0.3}) scale(${-scale} ${scale})"/>`;
    }
  return `<defs>${definitions.join("")}</defs><g clip-path="url(#${prefix}-clip)">${glyphs}</g>`;
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
  const definitions = `<defs><linearGradient id="base-fill" x1="${0.5 + baseLX * 0.5}" y1="${0.5 + baseLY * 0.5}" x2="${0.5 - baseLX * 0.5}" y2="${0.5 - baseLY * 0.5}"><stop stop-color="${blend(base.fill, [255, 255, 255], 0.055)}"/><stop offset="1" stop-color="${blend(base.fill, [0, 0, 0], 0.4)}"/></linearGradient><linearGradient id="logo-fill" x1="${0.5 + lx * 0.5}" y1="${0.5 + ly * 0.5}" x2="${0.5 - lx * 0.5}" y2="${0.5 - ly * 0.5}"><stop stop-color="${blend(logo.fill, [255, 255, 255], 0.35 + gloss * 0.45)}"/><stop offset=".38" stop-color="${blend(logo.fill, [255, 255, 255], gloss * 0.3)}"/><stop offset="1" stop-color="${blend(logo.fill, [0, 0, 0], 0.12 + gloss * 0.18)}"/></linearGradient><filter id="base-shadow" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="10" stdDeviation="9" flood-opacity=".3"/></filter><filter id="logo-relief" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB"><feOffset in="SourceAlpha" dx="${depthX}" dy="${depthY}" result="extrusion"/><feFlood flood-color="${blend(logo.fill, [0, 0, 0], 0.67)}" result="side-color"/><feComposite in="side-color" in2="extrusion" operator="in" result="side"/><feGaussianBlur in="SourceAlpha" stdDeviation="${1.5 + logo.depth * 0.24}" result="blur"/><feOffset in="blur" dx="${rounded(-lx * (logo.depth + 5))}" dy="${rounded(-ly * (logo.depth + 5))}" result="shadow-shift"/><feFlood flood-color="#000000" flood-opacity="${logo.shadow / 100}" result="shadow-color"/><feComposite in="shadow-color" in2="shadow-shift" operator="in" result="shadow"/><feOffset in="SourceAlpha" dx="${bx}" dy="${by}" result="away"/><feComposite in="SourceAlpha" in2="away" operator="out" result="edge"/><feFlood flood-color="#ffffff" flood-opacity=".88" result="edge-color"/><feComposite in="edge-color" in2="edge" operator="in" result="edge-light"/><feOffset in="SourceAlpha" dx="${-bx}" dy="${-by}" result="toward"/><feComposite in="SourceAlpha" in2="toward" operator="out" result="dark-edge"/><feFlood flood-color="#111318" flood-opacity=".45" result="edge-shade"/><feComposite in="edge-shade" in2="dark-edge" operator="in" result="edge-dark"/><feMerge><feMergeNode in="shadow"/><feMergeNode in="side"/><feMergeNode in="SourceGraphic"/><feMergeNode in="edge-dark"/><feMergeNode in="edge-light"/></feMerge></filter></defs>`;
  // Keep the official path exact; apply its 2..14 source bounds to the editable layer bounds.
  const scaleX = logo.width / 12,
    scaleY = logo.height / 12;
  const baseMarkup = base.visible
    ? `<g id="icon-base" data-layer="base" transform="${layerTransform(base)}"><rect width="${base.width}" height="${base.height}" rx="${Math.min(base.rounding, base.width / 2, base.height / 2)}" fill="url(#base-fill)" filter="url(#base-shadow)"/></g>`
    : "";
  // Apply relief after scaling so bevel and depth remain in artboard units.
  const logoMarkup = logo.visible
    ? `<g id="linear-logo" data-layer="logo" transform="${layerTransform(logo)}"><g filter="url(#logo-relief)"><path d="${capPath}" transform="scale(${scaleX} ${scaleY}) translate(-2 -2)" fill="url(#logo-fill)"/></g><g transform="scale(${scaleX} ${scaleY}) translate(-2 -2)">${latticeMarkup()}</g></g>`
    : "";
  return `<title>ASCII mesh phase study</title>${definitions}${baseMarkup}${logoMarkup}`;
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
    localStorage.setItem("linear-ascii-sections-v1", JSON.stringify(state));
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
    selected === "logo" ? "Mesh emblem" : "Icon base";
  document.querySelector(".hint").textContent =
    selected === "logo"
      ? "Smooth cap and dense yellow character fields."
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
    document.querySelector("#mesh-fill").value = state.logo.meshFill;
    document.querySelector("#mesh-fill-code").textContent = state.logo.meshFill;
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
    `${selected === "logo" ? "Mesh emblem" : "Icon base"} · ${Math.round(layer.width)} × ${Math.round(layer.height)} · ${rounded(layer.rotation)}°`;
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
document.querySelector("#mesh-fill").addEventListener("input", (event) => {
  if (/^#[0-9a-f]{6}$/i.test(event.target.value)) {
    state.logo.meshFill = event.target.value;
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
  .addEventListener("click", () => download("ascii-mesh-icon.svg", serialize(iconMarkup())));
document
  .querySelector("#flat-export")
  .addEventListener("click", () =>
    download(
      "ascii-mesh-logo.svg",
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><g transform="rotate(${state.logo.rotation} 8 8)"><path fill="${state.logo.fill}" d="${capPath}"/>${latticeMarkup("flat")}</g></svg>`,
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
