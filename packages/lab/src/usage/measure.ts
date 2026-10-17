import { clearCache, measureNaturalWidth, prepareWithSegments } from "@chenglou/pretext";
import { useEffect, useState } from "react";

const DATA_SIZE = 11;

export function dataFont(family: string, weight = 400): string {
  return `${String(weight)} ${String(DATA_SIZE)}px ${family}`;
}

export function textWidth(text: string, font: string): number {
  return measureNaturalWidth(prepareWithSegments(text, font));
}

export function widest(texts: readonly string[], font: string): number {
  return Math.ceil(Math.max(0, ...texts.map((text) => textWidth(text, font))));
}

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
