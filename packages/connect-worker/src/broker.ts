/**
 * The Worker: route, authenticate per route, and answer every failure with
 * the contract's error body. Phone requests under `/r/` go to the public
 * relay, which answers in the Nyte server's envelope instead.
 */
import { BROKER_ROUTES, RELAY_PREFIX, UUID_PATTERN } from "@nyte-ai/connect";
import { PUBLIC_RELAY_METHODS, publicRelayTarget, relayRefusal } from "@nyte-ai/connect/relay";
import { publicKeySet } from "@nyte-ai/connect/signing";
import { parseWebOrigins } from "./config.ts";
import type { Env } from "./config.ts";
import { browserResponse, withBrowserCors } from "./cors.ts";
import { createContext, throttle } from "./context.ts";
import type { Context, Dependencies } from "./context.ts";
import { sweep } from "./cron.ts";
import { enrollDevice, releaseDevice, removeDevice } from "./devices.ts";
import {
  issueLease,
  linkEnvironment,
  listEnvironments,
  removeEnvironment,
} from "./environments.ts";
import { Refusal, json, refusal } from "./http.ts";
import { errorName } from "./log.ts";
import { connectRelay, relayPublic } from "./public-relay.ts";
import { handleWebhook } from "./webhook.ts";

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

const UUID = UUID_PATTERN.slice(1, -1);

const ENVIRONMENT_PATH = new RegExp(
  `^/v1/environments/(${UUID})(?:/(lease|relay)|/(devices)(?:/(${UUID})(/release)?)?)?$`,
  "u",
);

function browserMethods(url: URL): readonly string[] {
  const target = publicRelayTarget(url);

  if (target !== undefined) return PUBLIC_RELAY_METHODS[target.kind];

  if (url.pathname === BROKER_ROUTES.environments) return ["GET"];
  const match = ENVIRONMENT_PATH.exec(url.pathname);

  if (match === null) return [];
  const [, , action, devices, deviceId, release] = match;

  if (action !== undefined || release !== undefined) return [];

  if (devices === undefined || deviceId !== undefined) return ["DELETE"];

  return ["POST"];
}

function methodNotAllowed(allow: string): Response {
  return json(405, { error: { code: "invalid", message: "Method not allowed." } }, { allow });
}

async function route(context: Context, request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  const { method } = request;

  if (pathname === BROKER_ROUTES.keys) {
    if (method !== "GET") return methodNotAllowed("GET");

    return json(200, publicKeySet(context.config.signing.all), {
      "cache-control": "public, max-age=300",
    });
  }

  if (pathname === BROKER_ROUTES.webhook) {
    if (method !== "POST") return methodNotAllowed("POST");

    return handleWebhook(context, request);
  }

  if (pathname === BROKER_ROUTES.environments) {
    await throttle(context, "address", request.headers.get("cf-connecting-ip") ?? "unknown");

    if (method === "GET") return listEnvironments(context, request);

    if (method === "POST") return linkEnvironment(context, request);

    return methodNotAllowed("GET, POST");
  }

  const match = ENVIRONMENT_PATH.exec(pathname);

  if (match === null) throw new Refusal("not_found");
  const [, environmentId = "", action, devices, deviceId, release] = match;

  await throttle(context, "address", request.headers.get("cf-connecting-ip") ?? "unknown");

  if (action === "lease")
    return method === "POST"
      ? issueLease(context, request, environmentId)
      : methodNotAllowed("POST");

  if (action === "relay")
    return method === "GET"
      ? connectRelay(context, request, environmentId)
      : methodNotAllowed("GET");

  if (devices === undefined)
    return method === "DELETE"
      ? removeEnvironment(context, request, environmentId)
      : methodNotAllowed("DELETE");

  if (deviceId === undefined)
    return method === "POST"
      ? enrollDevice(context, request, environmentId)
      : methodNotAllowed("POST");

  if (release !== undefined)
    return method === "POST"
      ? releaseDevice(context, request, { environmentId, deviceId })
      : methodNotAllowed("POST");

  return method === "DELETE"
    ? removeDevice(context, request, { environmentId, deviceId })
    : methodNotAllowed("DELETE");
}

export function createBroker(dependencies: Dependencies) {
  const { log } = dependencies;

  return {
    async fetch(request: Request, env: Env, execution: ExecutionContext): Promise<Response> {
      const url = new URL(request.url);
      const publicRelay = url.pathname.startsWith(RELAY_PREFIX);
      const methods = browserMethods(url);
      const origins = parseWebOrigins(env.CONNECT_WEB_ORIGINS) ?? [];
      const cors = (response: Response) => withBrowserCors({ response, request, origins, methods });
      const browser = browserResponse({ request, origins, methods, publicRelay });

      if (browser !== undefined) return cors(browser);
      const context = createContext({
        env,
        dependencies,
        waitUntil: (task) => execution.waitUntil(task),
      });

      if (context === undefined)
        return cors(publicRelay ? relayRefusal("internal") : refusal("internal"));

      try {
        return cors(await (publicRelay ? relayPublic(context, request) : route(context, request)));
      } catch (error) {
        if (error instanceof Refusal)
          return cors(
            refusal(error.code, {
              status: error.status,
              headers: error.status === 429 || error.status === 503 ? { "retry-after": "60" } : {},
            }),
          );
        log.error("request.failed", { error: errorName(error) });

        return cors(publicRelay ? relayRefusal("internal") : refusal("internal"));
      }
    },

    async scheduled(_controller: unknown, env: Env, execution: ExecutionContext): Promise<void> {
      const context = createContext({
        env,
        dependencies,
        waitUntil: (task) => execution.waitUntil(task),
      });

      if (context !== undefined) await sweep(context);
    },
  };
}
