import { asId } from "@nyte-ai/schema";
import type {
  Authority,
  CallId,
  CredentialSource,
  HeadName,
  PrincipalId,
  RunId,
  SessionId,
} from "@nyte-ai/schema";
import { SdkError } from "./error.ts";

/** Returns who a connection acts as, what it may do, the credential it reconnects with, and the run it acts from; every handle closes over one. */
export interface ConnectionContext {
  readonly principal: PrincipalId;
  readonly authority: ReadonlySet<Authority>;
  readonly credential: CredentialSource;
  /** The durable step a tool invocation's connection acts from: its session, run, head and call, and the per-execution counter that acquisitions without an explicit id key by (`acq:<n>`), reset on every re-run of the step; null for a client. `before_send` sees the run; `sessions.create` records the run, head and call. */
  readonly origin: {
    readonly session: SessionId;
    readonly run: RunId;
    readonly head: HeadName;
    readonly call: CallId | null;
    readonly sequence: { next(): number };
  } | null;
}

/** The principal `open` connects as, with every authority; reserved, `pair` never mints it (decision 4). */
export const LOCAL: PrincipalId = asId<"principal">("local");

/** The principal a token connects as, with participant and owner; reserved, `pair` never mints it (decision 4). */
export const TOKEN: PrincipalId = asId<"principal">("token");

/** Every authority: what `LOCAL` holds. */
export const ALL_AUTHORITY: ReadonlySet<Authority> = new Set<Authority>([
  "participant",
  "owner",
  "maintenance",
]);

/** Participant and owner: what `TOKEN` holds. */
export const TOKEN_AUTHORITY: ReadonlySet<Authority> = new Set<Authority>(["participant", "owner"]);

/** Throws `denied` naming the operation unless the authority includes what it needs. */
export function requireAuthority(
  authority: ReadonlySet<Authority>,
  needed: Authority,
  operation: string,
): void {
  if (!authority.has(needed))
    throw new SdkError("denied", `${operation} needs ${needed} authority.`);
}
