/**
 * One local SDK served to the iOS app over `@nyte-ai/server`: a Node listener
 * on an ephemeral port, a bearer token made for this share and kept only in
 * memory. The server package owns parsing, auth, and SSE; Hono adapts Node's
 * request and response streams.
 *
 * The listener binds one address, never every interface. Loopback reaches a
 * simulator on this Mac; a tailnet address reaches this user's own devices
 * over Tailscale's authenticated network and nothing on the local wifi.
 *
 * Runners stay with the desktop host: a phone that drives a session attaches
 * it through the same per-session attachment the desktop uses for its own
 * sends, so stopping the share ends the listener and its streams but never
 * the work a session already accepted.
 */
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import type { Nyte, SessionId } from "@nyte-ai/core";
import { createNyteServer } from "@nyte-ai/server";

interface MobileShareOptions {
  readonly sdk: Nyte;
  /** The single address to bind and advertise; loopback when absent. */
  readonly host?: string;
  /** The desktop's release, answered on `/v1/info`. */
  readonly version: string;
  /** Volunteer this process as the session's runner; idempotent per session. */
  readonly attach: (sessionId: SessionId) => void;
}

export interface MobileShare {
  /** `http://<host>:<port>`, the exact base URL a client enters. */
  readonly address: string;
  readonly token: string;
  /** Close the listener, drop its connections, and end open watches. Accepted SDK work continues. */
  stop(): Promise<void>;
}

const LOOPBACK = "127.0.0.1";
/** Time for ended responses to flush before remaining connections are destroyed. */
const DRAIN_MS = 500;

export async function startMobileShare(options: MobileShareOptions): Promise<MobileShare> {
  const { sdk, attach } = options;
  const host = options.host ?? LOOPBACK;
  // 256 bits, URL-safe so it pastes anywhere a bearer can go; never written to disk or logs.
  const token = randomBytes(32).toString("base64url");
  const server = createNyteServer({
    sdk: {
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
    },
    version: options.version,
    auth: { kind: "token", token },
  });
  const listener = createServer(
    getRequestListener((request) => server.fetch(request), {
      hostname: host,
      overrideGlobalObjects: false,
    }),
  );
  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, host, () => {
      listener.off("error", reject);
      resolve();
    });
  });
  const bound = listener.address();
  if (bound === null || typeof bound === "string") {
    listener.close();
    server.close();
    throw new Error("The share listener has no TCP address");
  }
  return {
    address: `http://${host}:${String(bound.port)}`,
    token,
    async stop() {
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
