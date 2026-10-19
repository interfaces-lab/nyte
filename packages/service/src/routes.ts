import { createHash, timingSafeEqual } from "node:crypto";
import { ConnectLinkFailureSchema, ConnectViewSchema } from "@nyte-ai/connect";
import { Type } from "typebox";
import type { Static } from "typebox";

export const SERVICE_ROUTES = {
  prefix: "/_nyte/service/",
  connect: "/_nyte/service/connect",
  watch: "/_nyte/service/connect/watch",
  share: "/_nyte/service/connect/share",
  unlink: "/_nyte/service/connect/unlink",
} as const;

export const ServiceEventSchema = Type.Union([
  Type.Object({ kind: Type.Literal("view"), view: ConnectViewSchema }),
  Type.Object({ kind: Type.Literal("link_failed"), reason: ConnectLinkFailureSchema }),
  Type.Object({ kind: Type.Literal("error"), message: Type.String() }),
  Type.Object({ kind: Type.Literal("relay"), holder: Type.Boolean() }),
]);

export type ServiceEvent = Static<typeof ServiceEventSchema>;

export function serviceRoutes(
  token: string,
  route: (request: Request, pathname: string) => Promise<Response>,
): (request: Request) => Response | Promise<Response> | undefined {
  const digest = sha256(`Bearer ${token}`);

  return (request) => {
    const { pathname } = new URL(request.url);

    if (!pathname.startsWith(SERVICE_ROUTES.prefix)) return undefined;

    const presented = request.headers.get("authorization");

    if (presented === null || !timingSafeEqual(sha256(presented), digest))
      return Response.json({ message: "Unauthorized" }, { status: 401 });

    return route(request, pathname);
  };
}

function sha256(text: string): Buffer {
  return createHash("sha256").update(text).digest();
}
