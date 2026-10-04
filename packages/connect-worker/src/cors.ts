import { PROOF_HEADER } from "@nyte-ai/connect";
import { relayRefusal } from "@nyte-ai/connect/relay";
import { refusal } from "./http.ts";

const REQUEST_HEADERS = ["authorization", "content-type"];

export function browserResponse(input: {
  readonly request: Request;
  readonly origins: readonly string[];
  readonly methods: readonly string[];
  readonly publicRelay: boolean;
}): Response | undefined {
  const { request, origins, methods, publicRelay } = input;
  const origin = request.headers.get("origin");

  if (origin === null) return undefined;
  const denied = () => (publicRelay ? relayRefusal("forbidden") : refusal("forbidden"));

  if (!origins.includes(origin) || request.headers.has(PROOF_HEADER)) return denied();

  if (request.method !== "OPTIONS") return methods.includes(request.method) ? undefined : denied();
  const method = request.headers.get("access-control-request-method");
  const headers = (request.headers.get("access-control-request-headers") ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name.length > 0);

  if (method === null || !methods.includes(method)) return denied();

  if (headers.some((name) => !REQUEST_HEADERS.includes(name))) return denied();

  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-methods": methods.join(", "),
      "access-control-allow-headers": REQUEST_HEADERS.join(", "),
      "access-control-max-age": "600",
    },
  });
}

export function withBrowserCors(input: {
  readonly response: Response;
  readonly request: Request;
  readonly origins: readonly string[];
  readonly methods: readonly string[];
}): Response {
  const { response, request, origins, methods } = input;
  const origin = request.headers.get("origin");

  if (
    origin === null ||
    !origins.includes(origin) ||
    request.headers.has(PROOF_HEADER) ||
    !(request.method === "OPTIONS"
      ? methods.includes(request.headers.get("access-control-request-method") ?? "")
      : methods.includes(request.method))
  )
    return response;
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-expose-headers", "retry-after, allow");
  headers.append("vary", "Origin");

  return new Response(response.body, { status: response.status, headers });
}
