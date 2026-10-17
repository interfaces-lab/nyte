import { awaitAcceptance, createDeviceSecret, READINESS } from "@nyte-ai/connect/enrollment";
import type { DeviceCrypto } from "@nyte-ai/connect/enrollment";

export { createDeviceSecret } from "@nyte-ai/connect/enrollment";

export type { DeviceCrypto } from "@nyte-ai/connect/enrollment";

import { BrokerError, relayAddress } from "@nyte-ai/connect";
import type {
  BrokerClient,
  BrokerFailure,
  EnrollResponse,
  EnvironmentSummary,
} from "@nyte-ai/connect";
import type { ManagedConnection, SavedConnection } from "../connection/connection.ts";
import type { ConnectFailure } from "../connection/connect-copy.ts";
import type { SaveResult } from "../connection/connection-store.ts";
import { RELEASE_TIMEOUT_MS, releaseOnHost, releaseReplaced } from "./revocation.ts";

type Fetch = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;

export type ConnectEnding =
  | { readonly kind: "connected" }
  | { readonly kind: "broker"; readonly failure: BrokerFailure }
  | { readonly kind: "notAccepted" }
  | { readonly kind: "silent" }
  | {
      readonly kind: "unproven";
      readonly failure: Extract<
        ConnectFailure,
        { kind: "identityChanged" | "unverified" | "keychain" }
      >;
    }
  | { readonly kind: "notSaved" }
  /** Something this app does not recognize stopped it. */
  | { readonly kind: "unexpected"; readonly detail: string }
  | { readonly kind: "cancelled" };

export async function connectEnvironment(input: {
  readonly broker: BrokerClient;
  readonly environment: EnvironmentSummary;
  readonly origin: string;
  readonly ownerId: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly crypto: DeviceCrypto;
  readonly fetch: Fetch;
  readonly verify: (
    saved: ManagedConnection,
    signal: AbortSignal,
  ) => Promise<{ readonly kind: "verified" } | ConnectFailure>;
  readonly save: (saved: SavedConnection, signal: AbortSignal) => Promise<SaveResult>;
  readonly signal: AbortSignal;
  readonly readiness?: typeof READINESS;
}): Promise<ConnectEnding> {
  const { environment, signal } = input;
  const url = relayAddress(input.origin, environment.id);
  const secret = await createDeviceSecret(input.crypto);

  if (signal.aborted) return { kind: "cancelled" };
  let enrolled: EnrollResponse;

  try {
    enrolled = await input.broker.enroll({
      environmentId: environment.id,
      request: {
        clientId: input.clientId,
        clientName: input.clientName,
        digest: secret.digest,
        role: "controller",
      },
      signal,
    });
  } catch (cause) {
    if (signal.aborted) return { kind: "cancelled" };

    if (cause instanceof BrokerError) return { kind: "broker", failure: cause.failure };
    throw cause;
  }

  const saved: ManagedConnection = {
    kind: "managed",
    connection: { name: environment.name, url, token: secret.token },
    binding: {
      origin: input.origin,
      environmentId: environment.id,
      deviceId: enrolled.deviceId,
      ownerId: input.ownerId,
    },
  };

  const discard = () =>
    void releaseOnHost({
      connection: saved.connection,
      fetch: input.fetch,
      timeoutMs: RELEASE_TIMEOUT_MS,
    });

  const acceptance = await awaitAcceptance({
    connection: saved.connection,
    fetch: input.fetch,
    signal,
    readiness: input.readiness ?? READINESS,
  });

  if (acceptance !== "accepted") {
    discard();

    return { kind: acceptance };
  }

  const proof = await input.verify(saved, signal);

  if (proof.kind !== "verified") {
    discard();

    switch (proof.kind) {
      case "identityChanged":
      case "unverified":
      case "keychain":
        return { kind: "unproven", failure: proof };
      case "refused":
        return { kind: "notAccepted" };
      case "silent":
        return { kind: "silent" };
      case "cancelled":
        return { kind: "cancelled" };
      case "wrongServer":
        return { kind: "unexpected", detail: "The relay answered, but not as a Nyte host." };
      case "notSaved":
        return { kind: "notSaved" };
      case "unexpected":
        return { kind: "unexpected", detail: proof.detail };
      default: {
        const exhaustive: never = proof;

        return exhaustive;
      }
    }
  }

  const result = await input.save(saved, signal);

  if (result.kind === "saved") {
    releaseReplaced({ replaced: result.replaced, next: saved, fetch: input.fetch });

    return { kind: "connected" };
  }

  discard();

  return result.kind === "cancelled" ? { kind: "cancelled" } : { kind: "notSaved" };
}
