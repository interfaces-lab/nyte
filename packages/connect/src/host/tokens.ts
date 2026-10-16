import { Type } from "typebox";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";
import { BrokerError } from "../index.ts";
import type { BrokerKeys, LeaseClaims, PublicJwk } from "../index.ts";
import { brokerKey, verifyClaims } from "../signing.ts";
import type { TokenType } from "../signing.ts";
import type { ConnectLinkFailure } from "../view.ts";
import { AccountCancelled } from "./account.ts";
import type { DesktopBroker } from "./broker.ts";
import type { ConnectFiles } from "./context.ts";
import type { StoredLink } from "./store.ts";

/** A broker link transaction ended in `state` before this host linked. */
export class LinkStopped extends Error {
  readonly state: "pending" | "approved" | "denied" | "expired" | "cancelled";

  constructor(state: "pending" | "approved" | "denied" | "expired" | "cancelled") {
    super(`Link transaction ${state}`);
    this.name = "LinkStopped";
    this.state = state;
  }
}

/** The broker's refusal code, when `cause` is one. */
export function refusedCode(cause: unknown): string | undefined {
  return cause instanceof BrokerError && cause.failure.kind === "refused"
    ? cause.failure.code
    : undefined;
}

const SessionClaims = Type.Object({ sub: Type.String({ minLength: 1, maxLength: 128 }) });

/** The owner a session JWT names, read without verifying it: only the broker verifies it. */
export function sessionSubject(token: string): string | null {
  try {
    const payload: unknown = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
    );

    return Value.Check(SessionClaims, payload) ? payload.sub : null;
  } catch {
    return null;
  }
}

/** How a link attempt that threw `cause` is shown. */
export function linkFailure(cause: unknown, signal: AbortSignal): ConnectLinkFailure {
  if (signal.aborted || cause instanceof AccountCancelled) return "cancelled";

  if (cause instanceof LinkStopped) {
    switch (cause.state) {
      case "denied":
      case "expired":
      case "cancelled":
        return cause.state;
      default:
        return "refused";
    }
  }

  if (!(cause instanceof BrokerError)) return "refused";

  switch (cause.failure.kind) {
    case "network":
      return "network";
    case "refused":
      switch (cause.failure.code) {
        case "limit":
          return "limit";
        case "owner_disabled":
          return "owner_disabled";
        case "session_revoked":
          return "session_revoked";
        default:
          return "refused";
      }

    default:
      return "refused";
  }
}

interface HighWater {
  readonly environmentId: string;
  readonly generation: number;
  readonly policy: number;
  readonly iat: number;
}

/**
 * What this host learned about its current link: the devices it refused here
 * ahead of the broker, and the newest lease it accepted, below which no lease
 * or enrollment is taken. Unlinking or linking again forgets both.
 */
export class LinkTrust {
  readonly denied = new Set<string>();
  private highWater: HighWater | undefined;

  /** Whether `generation` is older than the newest lease accepted for the environment. */
  behindGeneration(environmentId: string, generation: number): boolean {
    const high = this.highWater;

    return high?.environmentId === environmentId && generation < high.generation;
  }

  /** Whether a lease is older than the newest accepted one: a lower generation or policy, or the same policy issued earlier. */
  behindLease(environmentId: string, claims: LeaseClaims): boolean {
    const high = this.highWater;

    return (
      high?.environmentId === environmentId &&
      (claims.generation < high.generation ||
        claims.policy < high.policy ||
        (claims.policy === high.policy && claims.iat < high.iat))
    );
  }

  accept(environmentId: string, claims: LeaseClaims): void {
    this.highWater = {
      environmentId,
      generation: claims.generation,
      policy: claims.policy,
      iat: claims.iat,
    };
  }

  forget(): void {
    this.highWater = undefined;
    this.denied.clear();
  }
}

/**
 * Verifies the tokens the broker signs for this host: a lease or an
 * enrollment for the linked environment. A key the stored set
 * lacks sends this host to the broker's key set, at most once per `keysMs`.
 */
export class BrokerKeyring {
  private readonly broker: DesktopBroker;
  private readonly files: ConnectFiles;
  private readonly keysMs: number;
  private readonly signal: AbortSignal;
  private keysReadAt = Number.NEGATIVE_INFINITY;

  constructor(broker: DesktopBroker, files: ConnectFiles, keysMs: number, signal: AbortSignal) {
    this.broker = broker;
    this.files = files;
    this.keysMs = keysMs;
    this.signal = signal;
  }

  /** The claims of a `typ` token for `link`'s environment, or undefined when it does not verify. */
  async verify<S extends TSchema>(
    link: StoredLink,
    token: string,
    expected: { readonly typ: TokenType; readonly schema: S; readonly lifetime: number },
  ): Promise<Static<S> | undefined> {
    const environmentId = link.environment.id;
    const key = brokerKey(link.brokerKeys, token) ?? (await this.readKeys(environmentId, token));

    if (key === undefined) return undefined;

    try {
      return await verifyClaims({
        token,
        key,
        typ: expected.typ,
        issuer: this.broker.origin,
        audience: environmentId,
        schema: expected.schema,
        lifetime: expected.lifetime,
      });
    } catch {
      return undefined;
    }
  }

  private async readKeys(environmentId: string, token: string): Promise<PublicJwk | undefined> {
    if (Date.now() < this.keysReadAt + this.keysMs) return undefined;
    this.keysReadAt = Date.now();
    let keys: BrokerKeys;

    try {
      keys = await this.broker.keys({ signal: this.signal });
    } catch {
      return undefined;
    }

    const key = brokerKey(keys, token);

    if (key === undefined) return undefined;
    await this.files
      .change((file) =>
        file.link?.environment.id === environmentId
          ? { ...file, link: { ...file.link, brokerKeys: keys } }
          : file,
      )
      .catch(() => undefined);

    return key;
  }
}
