/**
 * What the Worker asks an environment's relay Durable Object, by RPC. The
 * relay owns the environment's devices, policy, proofs and presence, so every
 * decision about them is made there, next to the desktop's socket. Node-safe:
 * the Worker and its Node tests see the binding only through this shape.
 *
 * Phone exchanges and the two WebSocket upgrades stay on `fetch`
 * (`relay-stub.ts`): their bodies stream and their callers go away.
 */
import type {
  EnrollRequest,
  EnrollResponse,
  EnvironmentSummary,
  ErrorCode,
  LeaseResponse,
} from "@nyte-ai/connect";
import { Type } from "typebox";
import type { Static } from "typebox";
import type { OwnerStatus } from "./store/rows.ts";

/** The relay's answer: a value, or the refusal the Worker answers with. Errors don't cross RPC; refusals do. */
export type Answer<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ErrorCode; readonly status?: number };

/** A desktop request signed by its machine key: the proof header and the exact body it covers. */
export interface Proven {
  readonly token: string;
  readonly body: string;
}

/** Who asks to remove something: the owner's verified Clerk session, or the desktop's machine key. */
export type Actor =
  | { readonly kind: "owner"; readonly ownerId: string }
  | { readonly kind: "desktop"; readonly proof: Proven };

/** What the owner's list shows of an environment beside its name. */
export type Presence = Pick<EnvironmentSummary, "online" | "lastSeenAt">;

export interface OwnerStanding {
  readonly status: OwnerStatus;
  readonly version: number;
}

/** The device a phone request's bearer must belong to, as `PUBLIC_RELAY_BEARER` names it. */
export const RelayAdmission = Type.Union([
  Type.Literal("none"),
  Type.Literal("active"),
  Type.Literal("reserved-or-active"),
]);

export type RelayAdmission = Static<typeof RelayAdmission>;

export interface EnvironmentApi {
  /** The signed allowlist the desktop renews every heartbeat. */
  lease(proof: Proven): Promise<Answer<LeaseResponse>>;
  enroll(input: {
    readonly ownerId: string;
    readonly sessionId: string;
    readonly body: EnrollRequest;
  }): Promise<Answer<EnrollResponse>>;
  /** The weak end: the device stops, its Clerk session is left alone. Desktop proof only. */
  release(input: { readonly proof: Proven; readonly deviceId: string }): Promise<Answer<null>>;
  /** The strong end: the device stops and its Clerk session is denied in D1 before this answers. */
  revokeDevice(input: {
    readonly actor: Actor;
    readonly deviceId: string;
  }): Promise<Answer<{ readonly sessionId: string }>>;
  revoke(actor: Actor): Promise<Answer<null>>;
  /** Presence for the owner's list, or null when the environment is revoked or another owner's. */
  status(ownerId: string): Promise<Presence | null>;
  /** The standing D1 holds for the owner. Older versions are ignored; deleted is final and revokes. */
  setOwner(standing: OwnerStanding): Promise<void>;
  fetch(request: Request): Promise<Response>;
}

export interface EnvironmentNamespace {
  getByName(environmentId: string): EnvironmentApi;
}
