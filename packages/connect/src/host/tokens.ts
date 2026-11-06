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
import type { ConnectStore, StoredLink } from "./store.ts";

export class LinkStopped extends Error {
  readonly state: "pending" | "approved" | "denied" | "expired" | "cancelled";

  constructor(state: "pending" | "approved" | "denied" | "expired" | "cancelled") {
    super(`Link transaction ${state}`);
    this.name = "LinkStopped";
    this.state = state;
  }
}

export function refusedCode(cause: unknown): string | undefined {
  return cause instanceof BrokerError && cause.failure.kind === "refused"
    ? cause.failure.code
    : undefined;
}

const SessionClaims = Type.Object({ sub: Type.String({ minLength: 1, maxLength: 128 }) });

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

export class LinkTrust {
  readonly denied = new Set<string>();
  private highWater: HighWater | undefined;

  behindGeneration(environmentId: string, generation: number): boolean {
    const high = this.highWater;

    return high?.environmentId === environmentId && generation < high.generation;
  }

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

export class BrokerKeyring {
  private readonly broker: DesktopBroker;
  private readonly store: ConnectStore;
  private readonly keysMs: number;
  private readonly signal: AbortSignal;
  private keysReadAt = Number.NEGATIVE_INFINITY;

  constructor(broker: DesktopBroker, store: ConnectStore, keysMs: number, signal: AbortSignal) {
    this.broker = broker;
    this.store = store;
    this.keysMs = keysMs;
    this.signal = signal;
  }

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
    await this.store
      .change((file) =>
        file.link?.environment.id === environmentId
          ? { ...file, link: { ...file.link, brokerKeys: keys } }
          : file,
      )
      .catch(() => undefined);

    return key;
  }
}
