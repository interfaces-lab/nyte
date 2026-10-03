/**
 * Adds OpenCode's per-conversation routing header before API dispatch.
 *
 * Based on https://github.com/earendil-works/pi/blob/561a2e066c0742e3d3e33c75d5d32a69b1d89194/packages/ai/src/providers/opencode-headers.ts
 * Synced with pi 561a2e066.
 */
import type { ProviderStreams, StreamOptions } from "../types.ts";

const OPENCODE_SESSION_HEADER = "x-opencode-session";

function withSessionHeader<TOptions extends StreamOptions>(
  options: TOptions | undefined,
): TOptions | undefined {
  if (!options?.sessionId) return options;

  // A null caller value is an explicit suppression, so presence alone counts as an override.
  const overridden = Object.keys(options.headers ?? {}).some(
    (key) => key.toLowerCase() === OPENCODE_SESSION_HEADER,
  );
  if (overridden) return options;

  return {
    ...options,
    headers: { ...options.headers, [OPENCODE_SESSION_HEADER]: options.sessionId },
  };
}

export function withOpenCodeSessionHeader(streams: ProviderStreams): ProviderStreams {
  return {
    ...streams,
    stream: (model, context, options) => streams.stream(model, context, withSessionHeader(options)),
    streamSimple: (model, context, options) =>
      streams.streamSimple(model, context, withSessionHeader(options)),
  };
}
