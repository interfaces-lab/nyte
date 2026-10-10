/**
 * Text is laid out before it is drawn. Pretext measures with the face the page
 * paints, so a table's columns shrink to their widest cell, a chart's gutter
 * fits its widest tick, and a readout flips sides before it clips.
 */
import { clearCache, measureNaturalWidth, prepareWithSegments } from "@chenglou/pretext";
import { useEffect, useState } from "react";

/** Data text is one size everywhere, so the measured font matches the painted one. */
export const DATA_SIZE = 11;

export function dataFont(family: string, weight = 400): string {
  return `${String(weight)} ${String(DATA_SIZE)}px ${family}`;
}

export function textWidth(text: string, font: string): number {
  return measureNaturalWidth(prepareWithSegments(text, font));
}

export function widest(texts: readonly string[], font: string): number {
  return Math.ceil(Math.max(0, ...texts.map((text) => textWidth(text, font))));
}

/**
 * The family a node paints with, once webfonts settle. Measuring a fallback
 * face would size every column wrong, so the cache is cleared when the real
 * face arrives.
 */
export function useFamily(node: HTMLElement | null): string | null {
  const [ready, setReady] = useState(document.fonts.status === "loaded");

  useEffect(() => {
    let live = true;

    void document.fonts.ready.then(() => {
      if (!live) return;

      clearCache();
      setReady(true);
    });

    return () => {
      live = false;
    };
  }, []);

  if (!ready || node === null) return null;

  return getComputedStyle(node).fontFamily;
}
