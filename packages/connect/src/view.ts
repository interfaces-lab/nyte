import { Type } from "typebox";
import type { Static } from "typebox";

export const ConnectUnavailableSchema = Type.Union([
  Type.Literal("not_configured"),
  Type.Literal("store_failed"),
  Type.Literal("origin_changed"),
]);

export type ConnectUnavailable = Static<typeof ConnectUnavailableSchema>;

export const ConnectAccountSchema = Type.Union([
  Type.Object({ kind: Type.Literal("unavailable") }),
  Type.Object({ kind: Type.Literal("signed_out") }),
  Type.Object({ kind: Type.Literal("signed_in"), label: Type.String() }),
]);

export type ConnectAccount = Static<typeof ConnectAccountSchema>;

export const ConnectLinkFailureSchema = Type.Union([
  Type.Literal("cancelled"),
  Type.Literal("network"),
  Type.Literal("limit"),
  Type.Literal("owner_disabled"),
  Type.Literal("session_revoked"),
  Type.Literal("denied"),
  Type.Literal("expired"),
  Type.Literal("refused"),
]);

export type ConnectLinkFailure = Static<typeof ConnectLinkFailureSchema>;

export const ConnectLinkingSchema = Type.Union([
  Type.Object({ kind: Type.Literal("idle") }),
  Type.Object({ kind: Type.Literal("waiting_for_account") }),
  Type.Object({
    kind: Type.Literal("awaiting_approval"),
    verifyUrl: Type.String(),
    userCode: Type.String(),
    fingerprint: Type.String(),
    expiresAt: Type.Number(),
  }),
  Type.Object({ kind: Type.Literal("linking") }),
  Type.Object({ kind: Type.Literal("failed"), reason: ConnectLinkFailureSchema }),
]);

export type ConnectLinking = Static<typeof ConnectLinkingSchema>;

export const ConnectLeaseSchema = Type.Union([
  Type.Object({ kind: Type.Literal("stopped") }),
  Type.Object({ kind: Type.Literal("pending") }),
  Type.Object({ kind: Type.Literal("current"), expiresAt: Type.Number() }),
  Type.Object({
    kind: Type.Literal("lapsed"),
    reason: Type.Union([Type.Literal("offline"), Type.Literal("owner_disabled")]),
  }),
]);

export type ConnectLease = Static<typeof ConnectLeaseSchema>;

export const ConnectRelaySchema = Type.Union([
  Type.Object({ kind: Type.Literal("stopped") }),
  Type.Object({ kind: Type.Literal("connecting") }),
  Type.Object({ kind: Type.Literal("connected") }),
  Type.Object({ kind: Type.Literal("retrying"), attempt: Type.Number() }),
  Type.Object({ kind: Type.Literal("failed"), reason: Type.Literal("replaced") }),
]);

export type ConnectRelay = Static<typeof ConnectRelaySchema>;

export const ConnectDeviceSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  createdAt: Type.Number(),
  authorized: Type.Boolean(),
});

export type ConnectDevice = Static<typeof ConnectDeviceSchema>;

export const ConnectNoticeSchema = Type.Union([
  Type.Object({ kind: Type.Literal("none") }),
  Type.Object({ kind: Type.Literal("revoked") }),
  Type.Object({ kind: Type.Literal("unlink_pending") }),
]);

export type ConnectNotice = Static<typeof ConnectNoticeSchema>;

export const ConnectViewSchema = Type.Union([
  Type.Object({ kind: Type.Literal("unavailable"), reason: ConnectUnavailableSchema }),
  Type.Object({
    kind: Type.Literal("unlinked"),
    account: ConnectAccountSchema,
    linking: ConnectLinkingSchema,
    notice: ConnectNoticeSchema,
  }),
  Type.Object({
    kind: Type.Literal("linked"),
    account: ConnectAccountSchema,
    owner: Type.Object({ id: Type.String(), label: Type.String() }),
    environment: Type.Object({
      id: Type.String(),
      name: Type.String(),
      address: Type.String(),
    }),
    enabled: Type.Boolean(),
    connection: ConnectRelaySchema,
    lease: ConnectLeaseSchema,
    devices: Type.Array(ConnectDeviceSchema),
  }),
]);

export type ConnectView = Static<typeof ConnectViewSchema>;
