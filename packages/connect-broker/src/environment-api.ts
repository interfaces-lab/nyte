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

export type Answer<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ErrorCode; readonly status?: number };

export interface Proven {
  readonly token: string;
  readonly body: string;
}

export type Actor =
  | { readonly kind: "owner"; readonly ownerId: string }
  | { readonly kind: "desktop"; readonly proof: Proven };

export type Presence = Pick<EnvironmentSummary, "online" | "lastSeenAt">;

export interface OwnerStanding {
  readonly status: OwnerStatus;
  readonly version: number;
}

export const RelayAdmission = Type.Union([
  Type.Literal("none"),
  Type.Literal("active"),
  Type.Literal("reserved-or-active"),
]);

export type RelayAdmission = Static<typeof RelayAdmission>;

export interface EnvironmentApi {
  lease(proof: Proven): Promise<Answer<LeaseResponse>>;
  enroll(input: {
    readonly ownerId: string;
    readonly sessionId: string;
    readonly body: EnrollRequest;
  }): Promise<Answer<EnrollResponse>>;
  release(input: { readonly proof: Proven; readonly deviceId: string }): Promise<Answer<null>>;
  revokeDevice(input: {
    readonly actor: Actor;
    readonly deviceId: string;
  }): Promise<Answer<{ readonly sessionId: string }>>;
  revoke(actor: Actor): Promise<Answer<null>>;
  status(ownerId: string): Promise<Presence | null>;
  setOwner(standing: OwnerStanding): Promise<void>;
  fetch(request: Request): Promise<Response>;
}

export interface EnvironmentNamespace {
  getByName(environmentId: string): EnvironmentApi;
}
