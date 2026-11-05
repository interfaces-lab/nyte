/**
 * The grid check's overlay. `drawOverlay` and `clearOverlay` run through `page.evaluate`, which sends
 * their source text, so neither may reference anything outside its own body.
 */
import type { Rect } from "./collect.ts";

export interface Mark {
  readonly label: string;
  readonly rect: Rect;
  /** A line the mark should have met: a rail's x or a row's expected line top. */
  readonly target: { readonly axis: "x" | "y"; readonly at: number } | null;
}

/** Outlines each violation with its number, over the page, until `clearOverlay`. */
export function drawOverlay(marks: readonly Mark[]): void {
  document.getElementById("__grid_overlay")?.remove();
  const ns = "http://www.w3.org/2000/svg";
  const root = document.createElement("div");
  root.id = "__grid_overlay";
  root.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("width", String(innerWidth));
  svg.setAttribute("height", String(innerHeight));
  root.append(svg);

  const add = (tag: string, attributes: Record<string, string | number>): SVGElement => {
    const element = document.createElementNS(ns, tag);

    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
    svg.append(element);

    return element;
  };

  for (const mark of marks) {
    const rect = mark.rect;
    add("rect", {
      x: rect.left,
      y: rect.top,
      width: Math.max(rect.width, 1),
      height: Math.max(rect.height, 1),
      fill: "rgba(255,40,40,0.12)",
      stroke: "#ff2828",
      "stroke-width": 1,
    });

    if (mark.target !== null) {
      const line =
        mark.target.axis === "x"
          ? {
              x1: mark.target.at,
              x2: mark.target.at,
              y1: rect.top - 4,
              y2: rect.top + rect.height + 4,
            }
          : {
              x1: rect.left - 4,
              x2: rect.left + rect.width + 4,
              y1: mark.target.at,
              y2: mark.target.at,
            };

      add("line", { ...line, stroke: "#00d0ff", "stroke-width": 1 });
    }

    const width = mark.label.length * 5.6 + 6;
    add("rect", {
      x: rect.left,
      y: rect.top - 11,
      width,
      height: 11,
      rx: 2,
      fill: "rgba(0,0,0,0.8)",
    });

    const text = add("text", {
      x: rect.left + 3,
      y: rect.top - 2.5,
      fill: "#ff8080",
      "font-size": 9,
      "font-family": "Menlo, monospace",
    });

    text.textContent = mark.label;
  }

  document.body.append(root);
}

export function clearOverlay(): void {
  document.getElementById("__grid_overlay")?.remove();
}
