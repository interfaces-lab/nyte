import type { CliRendererConfig } from "@opentui/core";

/** Spread into createCliRenderer; leave it demand-driven rather than calling start(). */
export const TUI_RENDERER_CONFIG = {
  // OpenTUI 0.5.10 divides 1000 by these values. Infinity removes both frame
  // budgets; zero falls back to 30/60. In-frame retries still yield for 1 ms.
  targetFps: Infinity,
  maxFps: Infinity,
  // Keep OpenTUI's platform thread default in production and both QA modes.
} satisfies CliRendererConfig;
