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
  attach: "/_nyte/service/attach",
  clients: "/_nyte/service/clients",
  retire: "/_nyte/service/retire",
} as const;

export const ServiceEventSchema = Type.Union([
  Type.Object({ kind: Type.Literal("view"), view: ConnectViewSchema }),
  Type.Object({ kind: Type.Literal("link_failed"), reason: ConnectLinkFailureSchema }),
  Type.Object({ kind: Type.Literal("error"), message: Type.String() }),
]);

export type ServiceEvent = Static<typeof ServiceEventSchema>;

export const AttachmentSchema = Type.Object({
  pid: Type.Integer({ minimum: 1 }),
  startedAt: Type.Number(),
  build: Type.String(),
  follows: Type.Boolean(),
});

export type Attachment = Static<typeof AttachmentSchema>;

export const HandoffSchema = Type.Object({
  kind: Type.Literal("retiring"),
  to: Type.Literal("desktop"),
});

export type Handoff = Static<typeof HandoffSchema>;

export const ServiceClientSchema = Type.Object({
  ...AttachmentSchema.properties,
  tty: Type.Union([Type.String(), Type.Null()]),
});

export type ServiceClient = Static<typeof ServiceClientSchema>;

export const BusySchema = Type.Object({
  clients: Type.Integer({ minimum: 0 }),
  working: Type.Boolean(),
});

export type Busy = Static<typeof BusySchema>;

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
