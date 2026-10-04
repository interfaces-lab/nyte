export type RoutingDecision =
  | { kind: "allow"; tenant: string; environment: string }
  | { kind: "deny"; status: 401 | 403 };

export async function routeNyteRequest({
  request,
  namespace,
  authorize,
  prefix = "",
}: {
  request: Request;
  namespace: {
    getByName(
      name: string,
    ):
      | { fetch(request: Request): Promise<Response> }
      | Promise<{ fetch(request: Request): Promise<Response> }>;
  };
  authorize: (request: Request) => RoutingDecision | Promise<RoutingDecision>;
  prefix?: string;
}): Promise<Response> {
  if (prefix !== "" && (!prefix.startsWith("/") || prefix.endsWith("/")))
    throw new TypeError("Routing prefix must start, but not end, with a slash");
  const decision = await authorize(request);

  if (decision.kind === "deny") return new Response(null, { status: decision.status });

  if (!decision.tenant || !decision.environment) return new Response(null, { status: 403 });

  if (request.headers.has("upgrade")) return new Response(null, { status: 426 });
  const url = new URL(request.url);

  if (!url.pathname.startsWith(`${prefix}/v1/`)) return new Response(null, { status: 404 });
  url.pathname = url.pathname.slice(prefix.length);
  const name = JSON.stringify([decision.tenant, decision.environment]);

  return (await namespace.getByName(name)).fetch(new Request(url, request));
}
