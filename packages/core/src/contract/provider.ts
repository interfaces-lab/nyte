import type {
  Disposer,
  HeadName,
  ProviderContinuationId,
  RefUpdate,
  RunId,
  RunView,
  SessionId,
} from "@nyte-ai/schema";
import type { ProviderId } from "@nyte-ai/schema/model";

export type ProviderRevocation = "stop" | "history" | "route" | "lease" | "close";

export interface ProviderHeadRegistration {
  readonly head: HeadName;
  readonly historyEpoch: number;
  readonly provider: ProviderId;
  readonly signal: AbortSignal;
  offer(id: ProviderContinuationId): Promise<"pending" | "claimed" | "stale">;
  abandon(id: ProviderContinuationId): Promise<void>;
  release(): Promise<void>;
}

export interface ProviderRunsApi {
  bind(input: {
    readonly head: HeadName;
    readonly run: RunId;
    readonly provider: ProviderId;
    readonly historyEpoch: number;
  }): Promise<ProviderHeadRegistration>;
}

export type RuntimeLaunchPolicy =
  | { readonly kind: "denied"; readonly reason: string }
  | { readonly kind: "gated" }
  | { readonly kind: "unattended" };

export interface RuntimeScope {
  readonly head: HeadName;
  readonly activity:
    | { readonly kind: "run"; readonly id: RunId }
    | { readonly kind: "continuation"; readonly id: ProviderContinuationId };
}

export interface RuntimePolicyGrant {
  readonly policy: RuntimeLaunchPolicy;
  readonly revoked: AbortSignal;
  /** Registers resource retirement in the policy mutation acknowledgement barrier. */
  onRevoke(retire: () => Promise<void>): Disposer;
}

export interface RuntimePolicyApi {
  acquire(input: {
    readonly provider: ProviderId;
    readonly head: HeadName;
    readonly signal: AbortSignal;
  }): Promise<RuntimePolicyGrant>;
}

export interface ProviderRunsTable {
  committed(updates: readonly RefUpdate[]): Promise<void>;
  history(updates: readonly RefUpdate[]): Promise<readonly RefUpdate[]>;
  api(session: SessionId, owner: string, signal: AbortSignal): ProviderRunsApi;
  held(session: SessionId, head: HeadName): boolean;
  start(session: SessionId, head: HeadName): Promise<RunView | null>;
  pending(session: SessionId, head: HeadName): Promise<boolean>;
  claim(
    session: SessionId,
    head: HeadName,
    run: RunId,
    id: ProviderContinuationId,
  ): Promise<"claimed" | "stale">;
  revoke(session: SessionId, head: HeadName, reason: ProviderRevocation): Promise<void>;
  retire(session: SessionId, run: RunId): Promise<readonly RefUpdate[]>;
}

export interface RuntimePolicyTable {
  api(session: SessionId, owner: string, lifetime: AbortSignal): RuntimePolicyApi;
  revoke(session: SessionId | null): Promise<void>;
}
