import { MacOSScrollAccel } from "@opentui/core";
import type { ScrollAcceleration } from "@opentui/core";

/** One wheel event moves three rows regardless of event timing. */
const FIXED_SCROLL_STEP: ScrollAcceleration = { tick: () => 3, reset: () => undefined };

/** Acceleration keeps per-viewport timing history, so each scroll box gets its own. */
export function createScrollAcceleration(accelerated: boolean): ScrollAcceleration {
  return accelerated ? new MacOSScrollAccel() : FIXED_SCROLL_STEP;
}
