import type { CliRendererConfig } from "@opentui/core";

/** Spread into createCliRenderer; leave it demand-driven rather than calling start(). */
export const TUI_RENDERER_CONFIG = {
  // A requested frame waits at most 1 ms after the last one, so a key echoes at
  // once; animations keep OpenTUI's 30 fps. An infinite rate stalls 0.6's
  // scheduler until the next input, so both stay finite.
  maxFps: 1000,
  debounceDelay: 1,
  // Keep OpenTUI's platform thread default in production and both QA modes.
} satisfies CliRendererConfig;
