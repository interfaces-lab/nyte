"use client";

import { useEffect } from "react";

/* The brand's four hues in oklch, top of the screen to bottom: the cyan, blue, violet, and pink tints. */
const HUES = [216.5, 268.3, 294.6, 349.9] as const;
const DRIFT = 0.36;
const DRIFT_SPAN = 700;

function lattice(index: number) {
  const n = Math.sin(index * 127.1) * 43758.5453;
  return n - Math.floor(n);
}

/* Smooth 1D value noise in [0, 1], so scrolling shifts the hue without stepping. */
function noise(at: number) {
  const index = Math.floor(at);
  const fraction = at - index;
  const eased = fraction * fraction * (3 - 2 * fraction);
  return lattice(index) + (lattice(index + 1) - lattice(index)) * eased;
}

function hueAt(position: number) {
  const scaled = Math.min(Math.max(position, 0), 1) * (HUES.length - 1);
  const index = Math.min(Math.floor(scaled), HUES.length - 2);
  const from = HUES[index] ?? HUES[0];
  const to = HUES[index + 1] ?? HUES[HUES.length - 1];
  return from + (to - from) * (scaled - index);
}

function inGamut(lightness: number, chroma: number, hue: number) {
  const a = chroma * Math.cos((hue * Math.PI) / 180);
  const b = chroma * Math.sin((hue * Math.PI) / 180);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].every((channel) => channel >= 0 && channel <= 1);
}

/* The most chroma sRGB holds at this lightness and hue, less a margin, never above the cap. */
function chromaFor(lightness: number, hue: number, cap: number) {
  let low = 0;
  let high = cap;
  for (let step = 0; step < 16; step++) {
    const middle = (low + high) / 2;
    if (inGamut(lightness, middle, hue)) low = middle;
    else high = middle;
  }
  return low * 0.9;
}

function selectionCenter(selection: Selection) {
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  if (rect.height > 0) return rect.top + rect.height / 2;
  const node = selection.anchorNode;
  const element = node instanceof Element ? node : node?.parentElement;
  const box = element?.getBoundingClientRect();
  return box ? box.top + box.height / 2 : null;
}

/*
 * ::selection paints one flat colour, so the gradient lives here: the hue is
 * sampled along the brand tints by where the selection sits on screen, nudged
 * by noise over the scroll offset, and recomputed as the page scrolls. The
 * stylesheet keeps the lightness; this fills in the chroma that fits it.
 */
export function SelectionHue() {
  useEffect(() => {
    const root = document.documentElement;
    let frame = 0;
    let last = "";

    const update = () => {
      frame = 0;
      const selection = document.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
      const center = selectionCenter(selection);
      if (center === null) return;

      const drift = (noise(window.scrollY / DRIFT_SPAN) - 0.5) * DRIFT;
      const hue = hueAt(center / window.innerHeight + drift);
      const style = getComputedStyle(root);
      const lightness = Number(style.getPropertyValue("--selection-l"));
      const plateLightness = Number(style.getPropertyValue("--selection-plate-l"));
      const key = `${hue.toFixed(1)} ${lightness} ${plateLightness}`;
      if (key === last) return;
      last = key;

      root.style.setProperty("--selection-hue", hue.toFixed(1));
      root.style.setProperty("--selection-c", chromaFor(lightness, hue, 0.16).toFixed(3));
      root.style.setProperty(
        "--selection-plate-c",
        chromaFor(plateLightness, hue, 0.06).toFixed(3),
      );
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    document.addEventListener("selectionchange", schedule);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", schedule);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  return null;
}
