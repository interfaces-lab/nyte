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
  /** The durable step a connection acts from (a tool invocation, or a decide hook's handlers, §35i): its session, run and head (null for a step outside them, as `before_send`'s), call, and the per-execution counter that acquisitions without an explicit id key by (`acq:<n>`), reset on every re-run of the step; null for a client. `before_send` sees the run; `sessions.create` records the run, head and call when the run is set. */
  readonly origin: {
    readonly session: SessionId;
    readonly run: RunId | null;
    readonly head: HeadName | null;
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

/** What core acts as on its own behalf: `LOCAL` with participant and owner authority (no maintenance), no credential to reconnect with, and no origin; plugin apis and command prompts act through it. */
export const CORE_CONTEXT: ConnectionContext = {
  principal: LOCAL,
  authority: TOKEN_AUTHORITY,
  credential: { kind: "token", token: "" },
  origin: null,
};

/** Participant alone: what a tool invocation's connection holds. */
export const PARTICIPANT_AUTHORITY: ReadonlySet<Authority> = new Set<Authority>(["participant"]);

/** Throws `denied` naming the operation unless the authority includes what it needs. */
export function requireAuthority(
  authority: ReadonlySet<Authority>,
  needed: Authority,
  operation: string,
): void {
  if (!authority.has(needed))
    throw new SdkError("denied", `${operation} needs ${needed} authority.`);
}
