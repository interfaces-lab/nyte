/**
 * `@nyte-ai/serve`: a composed SDK behind `@nyte-ai/server/node`, and optionally
 * the built web app from the same origin, so a browser needs no CORS. The web
 * app's own origins are always allowed beside `browserOrigins`.
 */
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { APP_ORIGINS } from "@nyte-ai/app/web/origins.ts";
import type { Nyte, SessionId } from "@nyte-ai/core";
import { serve } from "@nyte-ai/server/node";
import type { ServeOptions as ListenOptions, Serving } from "@nyte-ai/server/node";
import { createStaticHandler } from "./static.ts";

export type { Serving } from "@nyte-ai/server/node";
export { findTailnetAddress } from "./tailnet.ts";
export type { TailnetAddress, TailnetLookup } from "./tailnet.ts";
export { loadOrCreateToken, randomToken } from "./token.ts";

export interface ServeOptions extends ListenOptions {
  /** Volunteer this process as a session's runner; idempotent per session. */
  readonly attach?: (sessionId: SessionId) => void;
  /** Directory of the built web app; omit to serve the API alone. */
  readonly appRoot?: string;
}

/** `packages/app/dist` as installed; it exists only after `pnpm --dir packages/app build`. */
export function appDistRoot(): string {
  return dirname(fileURLToPath(import.meta.resolve("@nyte-ai/app/dist/index.html")));
}

/**
 * The web app's pairing link. Host and token ride in the fragment, which a
 * browser never sends, so the token stays out of request lines and proxy logs.
 */
export function pairingUrl(appOrigin: string, address: string, token: string): string {
  return `${appOrigin}/pair#host=${encodeURIComponent(address)}&token=${encodeURIComponent(token)}`;
}

/** Where a pairing link opens: the served app, or the hosted one when this listener serves the API alone. */
export function pairingOrigin(address: string, appRoot: string | undefined): string {
  return appRoot === undefined ? APP_ORIGINS[0] : address;
}

function attaching(sdk: Nyte, attach: (sessionId: SessionId) => void): Nyte {
  return {
    ...sdk,
    messages: {
      ...sdk.messages,
      send(input) {
        attach(input.sessionId);

        return sdk.messages.send(input);
      },
      redeliver(input) {
        attach(input.sessionId);

        return sdk.messages.redeliver(input);
      },
    },
    jobs: {
      ...sdk.jobs,
      start(input) {
        attach(input.sessionId);

        return sdk.jobs.start(input);
      },
    },
    runs: {
      ...sdk.runs,
      reply(input) {
        attach(input.sessionId);

        return sdk.runs.reply(input);
      },
    },
    watch(input) {
      attach(input.sessionId);

      return sdk.watch(input);
    },
  };
}

export function startServe(options: ServeOptions): Promise<Serving> {
  const { attach, appRoot, ...listen } = options;
  const serveApp = appRoot === undefined ? undefined : createStaticHandler(appRoot);

  return serve({
    ...listen,
    sdk: attach === undefined ? options.sdk : attaching(options.sdk, attach),
    browserOrigins: [...APP_ORIGINS, ...(options.browserOrigins ?? [])],
    handle: async (request) => (await options.handle?.(request)) ?? (await serveApp?.(request)),
  });
}
