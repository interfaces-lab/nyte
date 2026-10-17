/**
 * Adds OpenCode's per-conversation routing header before API dispatch.
 */
import type { ProviderStreams, StreamOptions } from "../types.ts";

const OPENCODE_SESSION_HEADER = "x-opencode-session";

/** Adds the session header unless the caller set one; a null caller value is an explicit suppression, so presence alone counts as an override. */
function withSessionHeader<TOptions extends StreamOptions>(
  options: TOptions | undefined,
): TOptions | undefined {
  if (!options?.sessionId) return options;

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
