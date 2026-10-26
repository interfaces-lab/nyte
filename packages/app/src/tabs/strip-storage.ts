import type { Strip } from "./strip.ts";

/**
 * One strip per window slot. The desktop main process hands each window the lowest free slot,
 * so the first window of a launch is slot 0 and restores the last launch's first window.
 * Writing per slot on every change replaces the focus-gated mirror, which lost a tab switch
 * whenever the window wasn't focused at the time.
 */
const STRIP_KEY_PREFIX = "nyte.desktop.strip.v2:";

export function stripKey(slot: number): string {
  return `${STRIP_KEY_PREFIX}${String(slot)}`;
}

/** Validates against the stored schema; an unreadable strip starts empty rather than failing. */
export function readStrip(slot: number): Strip | undefined {
  void slot;
  throw new Error("not implemented");
}

export function writeStrip(slot: number, strip: Strip): void {
  void slot;
  void strip;
  throw new Error("not implemented");
}
