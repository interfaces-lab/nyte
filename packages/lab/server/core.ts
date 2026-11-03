import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import type { Host, Listener, Plugin } from "@nyte-ai/core";
import { sdk } from "@nyte-ai/sdk";

/** The lab's own Nyte home: its store, secret key, provider logins and `.nyte/mcp.json`. */
export const LAB_HOME = join(process.cwd(), ".local", "home");

/** Core reads this checkout; the read-only plugin keeps it from changing anything. */
const WORKSPACE = resolve(process.cwd(), "../..");

interface Core {
  readonly host: Host;
  readonly listener: Listener;
  readonly token: string;
}

declare global {
  /** One core per dev server: Start re-runs server modules on every edit. */
  var nyteLabCore: Promise<Core> | undefined;
}

/** Edit, write and shell come built in; the lab turns them off by rejecting each call. */
const readOnly = {
  id: "lab-read-only",
  hooks: {
    before_tool: (call) =>
      call.class.kind === "edit" || call.class.kind === "shell"
        ? {
            action: "reject",
            reason: "The lab's core is read-only: it turns off file edits and shell commands.",
          }
        : { action: "continue" },
  },
} satisfies Plugin<"core">;

async function open(): Promise<Core> {
  const host = await sdk.open({
    home: LAB_HOME,
    workspace: { kind: "local", path: WORKSPACE },
    plugins: [readOnly],
    label: "lab",
  });

  const token = randomBytes(24).toString("base64url");

  const listener = await host
    .listen({ transport: { kind: "fetch" }, auth: { kind: "token", token } })
    .catch(async (cause: unknown) => {
      await host.close();
      throw cause;
    });

  console.info(`[lab core] open on ${WORKSPACE}, home ${LAB_HOME}`);

  return { host, listener, token };
}

function core(): Promise<Core> {
  globalThis.nyteLabCore ??= open().catch((cause: unknown) => {
    globalThis.nyteLabCore = undefined;
    throw cause;
  });

  return globalThis.nyteLabCore;
}

/** What the page's bridge stub answers for `host.endpoint`; same origin, so no other site reads it. */
export async function serveEndpoint(request: Request): Promise<Response> {
  const opened = await core();

  return Response.json({
    url: new URL("/core/nyte", request.url).href,
    credentials: { kind: "token", token: opened.token },
  });
}

/**
 * The host's own protocol, below `/core/nyte`. Node needs `duplex` to pass a streamed body on, and
 * its `RequestInit` type doesn't name it yet.
 */
export async function serveCore(request: Request): Promise<Response> {
  const opened = await core();
  const url = new URL(request.url);
  url.pathname = url.pathname.slice("/core/nyte".length) || "/";

  const init = {
    method: request.method,
    headers: request.headers,
    signal: request.signal,
    body: request.body,
    duplex: "half" as const,
  };

  return opened.listener.fetch(new Request(url.href, init));
}
