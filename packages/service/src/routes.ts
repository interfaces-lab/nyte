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
]);

export type ServiceEvent = Static<typeof ServiceEventSchema>;
