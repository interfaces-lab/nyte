import { formatHex } from "./inspect.ts";
import type { Inspection, Rgba, TokenMatch } from "./inspect.ts";
import type { Box, LabelParts } from "./picker.ts";

const ARROW = 8;

const LABEL_GAP = 4;

const EDGE = 8;

const ARROW_INSET = 16;

const SVG = "http://www.w3.org/2000/svg";

const ARROW_UP = "M0 8 L7.3 0.7 A1 1 0 0 1 8.7 0.7 L16 8 Z";

const ARROW_DOWN = "M0 0 L7.3 7.3 A1 1 0 0 0 8.7 7.3 L16 0 Z";

export const LABEL_CSS = `
.callout {
  --surface: rgb(24 24 27);
  --text: rgb(250 250 250);
  --muted: rgb(250 250 250 / 0.62);
  --hairline: rgb(250 250 250 / 0.16);
  position: fixed;
  left: 0;
  top: 0;
  pointer-events: none;
  filter: drop-shadow(0 2px 12px rgb(0 0 0 / 0.1));
  font-family: system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}
@media (prefers-color-scheme: dark) {
  .callout {
    --surface: rgb(250 250 250);
    --text: rgb(24 24 27);
    --muted: rgb(24 24 27 / 0.62);
    --hairline: rgb(24 24 27 / 0.16);
  }
}
.callout[hidden] { display: none; }
.arrow { position: absolute; display: block; z-index: 1; fill: var(--surface); transform: translateX(-50%); }
.arrow.up { top: ${String(1 - ARROW)}px; }
.arrow.down { bottom: ${String(1 - ARROW)}px; }
.card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 10px;
  background: var(--surface);
  color: var(--text);
}
.tag {
  display: block;
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  line-height: 16px;
  font-weight: 500;
}
.muted { color: var(--muted); }
.facts {
  display: grid;
  grid-template-columns: auto 1fr;
  column-gap: 12px;
  row-gap: 3px;
  margin: 0;
  font-size: 12px;
  line-height: 16px;
  font-variant-numeric: tabular-nums;
}
.facts dt { color: var(--muted); }
.facts dd { display: flex; align-items: center; gap: 6px; margin: 0; white-space: nowrap; }
.swatch { flex-shrink: 0; width: 10px; height: 10px; border-radius: 3px; box-shadow: 0 0 0 1px var(--hairline); }
`;

export interface HoverCard {
  readonly box: Box;
  readonly anchorX: number | undefined;
  readonly parts: LabelParts;
  readonly inspection: Inspection;
}

export interface Label {
  readonly element: HTMLElement;
  show(card: HoverCard, viewport: { readonly width: number; readonly height: number }): void;
  hide(): void;
}

export function createLabel(): Label {
  const element = document.createElement("div");
  const arrow = document.createElementNS(SVG, "svg");
  const path = document.createElementNS(SVG, "path");
  const card = document.createElement("div");

  element.className = "callout";
  element.hidden = true;
  arrow.setAttribute("width", String(ARROW * 2));
  arrow.setAttribute("height", String(ARROW));
  arrow.setAttribute("viewBox", `0 0 ${String(ARROW * 2)} ${String(ARROW)}`);
  arrow.append(path);
  card.className = "card";
  element.append(arrow, card);

  return {
    element,
    show(shown, viewport) {
      card.replaceChildren(tag(shown.parts), facts(shown.inspection));
      element.hidden = false;
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      const box = shown.box;
      const reach = ARROW + LABEL_GAP;

      const center = Math.min(
        Math.max(shown.anchorX ?? box.x + box.width / 2, box.x),
        box.x + box.width,
      );

      const below = box.y + box.height + reach;
      const fitsBelow = below + height <= viewport.height - EDGE;
      const top = Math.max(EDGE, fitsBelow ? below : box.y - height - reach);
      const left = Math.min(Math.max(center - width / 2, EDGE), viewport.width - EDGE - width);

      element.style.transform = `translate(${String(left)}px, ${String(top)}px)`;
      arrow.setAttribute("class", fitsBelow ? "arrow up" : "arrow down");
      arrow.style.left = `${String(Math.min(Math.max(center - left, ARROW_INSET), width - ARROW_INSET))}px`;
      path.setAttribute("d", fitsBelow ? ARROW_UP : ARROW_DOWN);
    },
    hide() {
      element.hidden = true;
    },
  };
}

function tag(parts: LabelParts): HTMLElement {
  const element = document.createElement("span");

  element.className = "tag";
  element.append(parts.name);

  if (parts.detail !== "") element.append(muted(` ${parts.detail}`));

  return element;
}

function facts(inspection: Inspection): HTMLElement {
  const list = document.createElement("dl");
  const type = `${inspection.font} ${String(Math.round(inspection.size))}/${inspection.lineHeight} · ${inspection.weight}`;
  const contrast = inspection.contrast;
  const level = contrast.level === "fail" ? "Fails AA" : contrast.level;

  list.className = "facts";
  list.append(
    ...fact("Type", [type]),
    ...fact("Text", colorFact(inspection.ink, inspection.inkToken)),
    ...fact("Fill", colorFact(inspection.paper, inspection.paperToken)),
    ...fact("Contrast", [
      `${contrast.ratio.toFixed(2)}:1`,
      muted(` · ${level}${contrast.large ? ", large text" : ""}`),
    ]),
  );

  return list;
}

function fact(term: string, value: readonly (Node | string)[]): readonly HTMLElement[] {
  const name = document.createElement("dt");
  const detail = document.createElement("dd");

  name.append(term);
  detail.append(...value);

  return [name, detail];
}

function colorFact(color: Rgba, token: TokenMatch | undefined): readonly (Node | string)[] {
  const swatch = document.createElement("span");

  swatch.className = "swatch";
  swatch.style.backgroundColor = `rgb(${String(color.r)} ${String(color.g)} ${String(color.b)} / ${String(color.a)})`;

  if (token === undefined) return [swatch, formatHex(color)];

  return [
    swatch,
    formatHex(color),
    muted(` ${token.distance < 1 ? token.name : `≈ ${token.name}`}`),
  ];
}

function muted(text: string): HTMLElement {
  const element = document.createElement("span");

  element.className = "muted";
  element.append(text);

  return element;
}
