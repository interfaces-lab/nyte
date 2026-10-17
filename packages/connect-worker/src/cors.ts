import { PROOF_HEADER } from "@nyte-ai/connect";
import {
  RELAY_REQUEST_HEADER_NAMES,
  RELAY_RESPONSE_HEADER_NAMES,
  relayRefusal,
} from "@nyte-ai/connect/relay";
import { refusal } from "./http.ts";

const REQUEST_HEADERS: readonly string[] = ["authorization", "content-type"];

const EXPOSED_HEADERS = ["retry-after", "allow"];

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
  const allowed: readonly string[] = publicRelay ? RELAY_REQUEST_HEADER_NAMES : REQUEST_HEADERS;

  if (headers.some((name) => !allowed.includes(name))) return denied();

  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-methods": methods.join(", "),
      "access-control-allow-headers": allowed.join(", "),
      "access-control-max-age": "600",
    },
  });
}

export function withBrowserCors(input: {
  readonly response: Response;
  readonly request: Request;
  readonly origins: readonly string[];
  readonly methods: readonly string[];
  readonly publicRelay: boolean;
}): Response {
  const { response, request, origins, methods, publicRelay } = input;
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
  headers.set(
    "access-control-expose-headers",
    (publicRelay ? [...EXPOSED_HEADERS, ...RELAY_RESPONSE_HEADER_NAMES] : EXPOSED_HEADERS).join(
      ", ",
    ),
  );
  headers.append("vary", "Origin");

  return new Response(response.body, { status: response.status, headers });
}
