import { createHash } from "node:crypto";
import { Value } from "typebox/value";
import { DESKTOP_ROUTES, EnrollEnvelope } from "../index.ts";
import type { ErrorCode } from "../index.ts";

const BODY_LIMIT_BYTES = 16_384;

export type RouteAnswer =
  | { readonly kind: "json"; readonly status: 200; readonly body: unknown }
  | { readonly kind: "empty" }
  | { readonly kind: "refused"; readonly status: RefusalStatus; readonly code: ErrorCode };

export interface ConnectRoutes {
  /** `127.0.0.1:<port>` once the listener is bound; until then every request is refused. */
  readonly host: () => string | undefined;
  /** Verify a broker enrollment, record the device, and answer with a signed receipt. */
  enroll(authorization: string): Promise<RouteAnswer>;
  /** Remove the device whose token digest this is. */
  forget(digest: Buffer): Promise<RouteAnswer>;
}

const MESSAGES = {
  400: "The request does not match the contract",
  401: "The credential did not verify",
  403: "Refused",
  404: "Not found",
  405: "Method not allowed",
  409: "Already answered or in conflict",
  413: "The body is too large",
  415: "Send JSON",
  429: "Too many enrollments at once",
  500: "The desktop could not record this",
} as const;

type RefusalStatus = keyof typeof MESSAGES;

export function refused(status: RefusalStatus, code: ErrorCode): RouteAnswer {
  return { kind: "refused", status, code };
}

function respond(answer: RouteAnswer): Response {
  const headers = new Headers({ "cache-control": "no-store" });

  if (answer.kind === "empty") return new Response(null, { status: 204, headers });
  headers.set("content-type", "application/json; charset=utf-8");

  if (answer.kind === "json")
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers });

  return new Response(
    JSON.stringify({
      error: { code: answer.code, message: MESSAGES[answer.status] },
    }),
    { status: answer.status, headers },
  );
}

/** The request as device authorization reads it: the bearer header, nothing else. */
export interface AuthorizingRequest {
  readonly headers: { get(name: string): string | null };
}

/** `Authorization: Bearer <token>`, read the way the host listener reads it. */
export function bearerToken(request: AuthorizingRequest): string | undefined {
  const header = request.headers.get("authorization");

  if (header === null) return undefined;
  const space = header.indexOf(" ");

  if (space === -1 || header.slice(0, space).toLowerCase() !== "bearer") return undefined;
  const token = header.slice(space + 1).trim();

  return token === "" ? undefined : token;
}

export function tokenDigest(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

async function limitedBody(request: Request): Promise<string | undefined> {
  const declared = Number(request.headers.get("content-length") ?? "0");

  if (!Number.isFinite(declared) || declared > BODY_LIMIT_BYTES) return undefined;
  const reader = request.body?.getReader();

  if (reader === undefined) return "";
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";

  for (;;) {
    const { done, value } = await reader.read();

    if (done) break;
    size += value.byteLength;

    if (size > BODY_LIMIT_BYTES) return undefined;

    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

function addressed(request: Request, host: string | undefined): boolean {
  let url: URL;

  try {
    url = new URL(request.url);
  } catch {
    return false;
  }

  return (
    host !== undefined &&
    request.headers.get("host") === host &&
    url.host === host &&
    !request.headers.has("forwarded") &&
    !request.headers.has("x-forwarded-host")
  );
}

export function connectRouteHandler(
  routes: ConnectRoutes,
): (request: Request) => Promise<Response | undefined> {
  return async (request) => {
    const { pathname } = new URL(request.url);

    if (!pathname.startsWith(DESKTOP_ROUTES.prefix)) return undefined;

    if (request.headers.has("origin") || !addressed(request, routes.host()))
      return respond(refused(403, "forbidden"));

    if (pathname === DESKTOP_ROUTES.enroll) {
      if (request.method !== "POST") return respond(refused(405, "invalid"));

      if (!/^application\/json(?:;|$)/iu.test(request.headers.get("content-type") ?? ""))
        return respond(refused(415, "invalid"));
      const text = await limitedBody(request);

      if (text === undefined) return respond(refused(413, "invalid"));
      let envelope: unknown;

      try {
        envelope = JSON.parse(text);
      } catch {
        return respond(refused(400, "invalid"));
      }

      if (!Value.Check(EnrollEnvelope, envelope)) return respond(refused(400, "invalid"));

      return respond(await routes.enroll(envelope.authorization));
    }

    if (pathname === DESKTOP_ROUTES.device) {
      if (request.method !== "DELETE") return respond(refused(405, "invalid"));
      const token = bearerToken(request);

      if (token === undefined) return respond(refused(401, "unauthorized"));

      return respond(await routes.forget(tokenDigest(token)));
    }

    return respond(refused(404, "not_found"));
  };
}
