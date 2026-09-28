/**
 * `@nyte-ai/serve`: a composed SDK behind `@nyte-ai/server` on one address,
 * and optionally the built web app from the same origin, so a browser needs no CORS.
 *
 * The listener binds one address, never every interface. Stopping it ends the
 * listener and its streams but never the work a session already accepted.
 */
import { createServer } from "node:http";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getRequestListener } from "@hono/node-server";
import { APP_ORIGINS } from "@nyte-ai/app/web/origins.ts";
import type { Nyte, SessionId } from "@nyte-ai/core";
import type { Environment, ServerDescription } from "@nyte-ai/protocol";
import { createNyteServer } from "@nyte-ai/server";
import { createStaticHandler } from "./static.ts";

export { findTailnetAddress } from "./tailnet.ts";
export type { TailnetAddress, TailnetLookup } from "./tailnet.ts";
export { loadOrCreateToken, randomToken } from "./token.ts";

export interface ServeOptions {
  /** Already composed; serve never composes. */
  readonly sdk: Nyte;
  /** Volunteer this process as a session's runner; idempotent per session. */
  readonly attach?: (sessionId: SessionId) => void;
  /** The serving machine's providers, usage, and GitHub login. Omit and `/v1/info` reports none. */
  readonly environment?: Environment;
  readonly version: string;
  readonly describe?: () => ServerDescription;
  /** The single address to bind and advertise. Default 127.0.0.1. */
  readonly host?: string;
  /** Default 0: an ephemeral port. */
  readonly port?: number;
  /** At least 16 characters. */
  readonly token: string;
  /** Directory of the built web app; omit to serve the API alone. */
  readonly appRoot?: string;
}

export interface Serving {
  /** `http://<host>:<port>`, the base URL a client enters. */
  readonly address: string;
  readonly token: string;
  /** The served app's pairing link, or the hosted app's when no app is served. */
  readonly pairingUrl: string;
  /** Close the listener, drop its connections, and end open watches. Accepted SDK work continues. */
  close(): Promise<void>;
}

/** Time for ended responses to flush before remaining connections are destroyed. */
const DRAIN_MS = 500;

/** `packages/app/dist` as installed; it exists only after `pnpm --dir packages/app build`. */
export function appDistRoot(): string {
  return dirname(fileURLToPath(import.meta.resolve("@nyte-ai/app/dist/index.html")));
}

export function pairingUrl(appOrigin: string, address: string, token: string): string {
  return `${appOrigin}/pair?host=${encodeURIComponent(address)}&token=${encodeURIComponent(token)}`;
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

export async function startServe(options: ServeOptions): Promise<Serving> {
  const { token } = options;
  const host = options.host ?? "127.0.0.1";

  if (token.length < 16) throw new Error("The token must be at least 16 characters.");

  const server = createNyteServer({
    sdk: options.attach === undefined ? options.sdk : attaching(options.sdk, options.attach),
    environment: options.environment,
    version: options.version,
    describe: options.describe,
    auth: { kind: "token", token },
    browserOrigins: [...APP_ORIGINS],
  });

  const serveApp = options.appRoot === undefined ? undefined : createStaticHandler(options.appRoot);

  const listener = createServer(
    getRequestListener(async (request) => (await serveApp?.(request)) ?? server.fetch(request), {
      hostname: host,
      overrideGlobalObjects: false,
    }),
  );

  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(options.port ?? 0, host, () => {
      listener.off("error", reject);
      resolve();
    });
  }).catch((cause: unknown) => {
    server.close();
    throw cause;
  });

  const bound = listener.address();

  if (bound === null || typeof bound === "string") {
    listener.close();
    server.close();
    throw new Error("The listener has no TCP address");
  }

  const address = `http://${host.includes(":") ? `[${host}]` : host}:${String(bound.port)}`;

  return {
    address,
    token,
    pairingUrl: pairingUrl(
      options.appRoot === undefined ? APP_ORIGINS[0] : address,
      address,
      token,
    ),
    async close() {
      // Watches end with a `closed` frame first, so a reading client hears why.
      server.close();
      const closed = new Promise<void>((resolve) => listener.close(() => resolve()));
      // A client that stopped reading would hold the listener open; cut what remains.
      const timer = setTimeout(() => listener.closeAllConnections(), DRAIN_MS);

      try {
        await closed;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
