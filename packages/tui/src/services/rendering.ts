import type { CliRendererConfig } from "@opentui/core";

/**
 * The interactive renderer's settings. OpenTUI tears the renderer down on its `exitSignals` and
 * leaves the process running, so it keeps only the fatal signals it restores the terminal for:
 * the TUI's lifecycle owns SIGINT, SIGTERM and SIGHUP and exits on them, and Bun ignores SIGPIPE.
 */
export const TUI_RENDERER_CONFIG = {
  maxFps: 60,
  debounceDelay: 16,
  exitSignals: ["SIGQUIT", "SIGABRT", "SIGBUS"],
} satisfies CliRendererConfig;
