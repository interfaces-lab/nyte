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
} as const;

export const ServiceEventSchema = Type.Union([
  Type.Object({ kind: Type.Literal("view"), view: ConnectViewSchema }),
  Type.Object({ kind: Type.Literal("link_failed"), reason: ConnectLinkFailureSchema }),
  Type.Object({ kind: Type.Literal("error"), message: Type.String() }),
]);

export type ServiceEvent = Static<typeof ServiceEventSchema>;

/** A client process holding an attachment open: its pid, when the process started (ms since the epoch), and the build it expects. */
export const AttachmentSchema = Type.Object({
  pid: Type.Integer({ minimum: 1 }),
  startedAt: Type.Number(),
  build: Type.String(),
});

export type Attachment = Static<typeof AttachmentSchema>;

/** An attached client as `nyte service status` lists it: the attachment plus the process's terminal, null when it has none. */
export const ServiceClientSchema = Type.Object({
  ...AttachmentSchema.properties,
  tty: Type.Union([Type.String(), Type.Null()]),
});

export type ServiceClient = Static<typeof ServiceClientSchema>;
