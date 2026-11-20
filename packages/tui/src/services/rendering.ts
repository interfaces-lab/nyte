import { SystemClock } from "@opentui/core";
import type { CliRendererConfig } from "@opentui/core";

class WallClock extends SystemClock {
  override now(): number {
    return Date.now();
  }
}

export const TUI_RENDERER_CONFIG = {
  maxFps: 60,
  debounceDelay: 16,
  exitSignals: ["SIGQUIT", "SIGABRT", "SIGBUS"],
  clock: new WallClock(),
} satisfies CliRendererConfig;
