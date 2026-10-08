import {
  createNyteClient,
  NyteTransportError,
  NyteWireError,
  type NyteClient,
} from "@nyte-ai/client";
import { base64ToBase64Url } from "@nyte-ai/connect";
import type { HostIdentity, ServerInfo } from "@nyte-ai/protocol";
import { fetch } from "expo/fetch";
import { deleteItemAsync, getItemAsync, setItemAsync } from "expo-secure-store";
import { displayAddress, type Connection, type SavedConnection } from "./connection.ts";
import { classifyConnectFailure, type ConnectFailure } from "./connect-copy.ts";
import { createConnectionStore } from "./connection-store.ts";
import { proveHost } from "./identity.ts";
import { createPinStore, routeOf } from "./pins.ts";
import { readAccountConfig } from "../account/account-config.ts";
import { deviceCrypto } from "../account/device.ts";
import { releaseReplaced } from "../account/revocation.ts";

const STORAGE_KEY = "nyte.host";

/** A host that hangs on resume is reported as silent rather than left spinning. */
const RESUME_TIMEOUT_MS = 10_000;

export const connectionStore = createConnectionStore(
  {
    read: () => getItemAsync(STORAGE_KEY),
    write: (text) => setItemAsync(STORAGE_KEY, text),
    remove: () => deleteItemAsync(STORAGE_KEY),
  },
  readAccountConfig(),
);

const pins = createPinStore({ read: getItemAsync, write: setItemAsync }, deviceCrypto);

/**
 * An account connection shares its origin with the broker, so it sends no
 * cookies. An address-and-token connection keeps the platform default.
 */
export function createHostClient(saved: SavedConnection, signal?: AbortSignal): NyteClient {
  const { url, token } = saved.connection;

  return createNyteClient({
    baseUrl: url,
    token,
    fetch:
      saved.kind === "managed"
        ? (input, init) =>
            fetch(input, { ...init, credentials: "omit", signal: signal ?? init?.signal })
        : (input, init) => fetch(input, { ...init, signal: signal ?? init?.signal }),
  });
}

/** What a verification admitted. Screens mount only under one of these. */
export interface VerifiedHost {
  /** `info.identity` is present only when the host just signed for it. */
  readonly info: ServerInfo;
  /** The host and principal stored state belongs to. Never holds a bearer. */
  readonly scope: string;
  /** New on every adoption, so a new credential or host remounts the connected tree. */
  readonly key: string;
}

export type HostVerification =
  | { readonly kind: "verified"; readonly host: VerifiedHost }
  | ConnectFailure;

/** Verified results by the saved object they were proven for, so a save adopts without asking twice. */
const verified = new WeakMap<SavedConnection, VerifiedHost>();

let adoptions = 0;

/**
 * A proven host is its identity. A cursor host without one is the address and
 * this exact credential's digest, so a new token at a reused address never
 * inherits the old one's drafts or queued intent.
 */
async function scopeOf(
  saved: SavedConnection,
  identity: HostIdentity | undefined,
): Promise<string> {
  const principal =
    saved.kind === "managed"
      ? ["device", saved.binding.ownerId, saved.binding.deviceId]
      : ["bearer"];

  if (identity !== undefined) return JSON.stringify(["host", identity.hostId, ...principal]);
  const credential = base64ToBase64Url(await deviceCrypto.sha256Base64(saved.connection.token));

  return JSON.stringify(["address", saved.connection.url, credential, ...principal]);
}

/**
 * `/v1/info` and, for a host that names an identity or a route that pinned
 * one, a signed nonce, all bound to `signal`. Nothing is saved or adopted
 * here; a newly proven identity is pinned before the result is returned.
 * This is the only place a client error is read, so nothing downstream holds
 * an `unknown` it could flatten into "No answer".
 */
export async function verifyHost(input: {
  readonly saved: SavedConnection;
  readonly repair: boolean;
  readonly signal: AbortSignal;
}): Promise<HostVerification> {
  const { saved, signal } = input;
  const route = routeOf(saved);
  const address = displayAddress(saved.connection);
  let pinned: HostIdentity | undefined;

  try {
    pinned = await pins.read(route);
  } catch {
    return { kind: "keychain" };
  }

  if (signal.aborted) return { kind: "cancelled" };
  let proof: Awaited<ReturnType<typeof proveHost>>;

  try {
    proof = await proveHost({
      client: createHostClient(saved, signal),
      pinned,
      repair: input.repair,
      crypto: deviceCrypto,
    });
  } catch (cause) {
    if (signal.aborted) return { kind: "cancelled" };

    if (cause instanceof NyteWireError || cause instanceof NyteTransportError)
      return classifyConnectFailure(cause, address);

    // The client raises only those two, so anything else is a bug in this app.
    return { kind: "unexpected", detail: cause instanceof Error ? cause.message : String(cause) };
  }

  if (signal.aborted) return { kind: "cancelled" };

  if (proof.kind === "identityChanged")
    return { kind: "identityChanged", address, url: saved.connection.url };

  if (proof.kind === "unverified") return { kind: "unverified", address };
  const identity = proof.kind === "proven" ? proof.info.identity : undefined;

  if (identity !== undefined && identity.publicKey.x !== pinned?.publicKey.x) {
    try {
      await pins.write(route, identity);
    } catch {
      return { kind: "keychain" };
    }
  }

  const scope = await scopeOf(saved, identity);

  // A timeout or a newer connection during the Keychain or digest work adopts nothing.
  if (signal.aborted) return { kind: "cancelled" };
  adoptions += 1;
  const host: VerifiedHost = { info: proof.info, scope, key: String(adoptions) };
  verified.set(saved, host);

  return { kind: "verified", host };
}

/** How one attempt ended. Only `connected` may open a session. */
export type ConnectResult = { readonly kind: "connected" } | ConnectFailure;

/** Verify the address and token, then the Keychain write, all under `signal`. */
export async function connectHost(input: {
  readonly connection: Connection;
  readonly repair: boolean;
  readonly signal: AbortSignal;
}): Promise<ConnectResult> {
  const { signal } = input;
  const next: SavedConnection = { kind: "manual", connection: input.connection };
  const result = await verifyHost({ saved: next, repair: input.repair, signal });

  if (result.kind !== "verified") return result;
  const saved = await connectionStore.save(next, signal);

  if (saved.kind === "failed") return { kind: "notSaved" };

  if (saved.kind === "cancelled") return { kind: "cancelled" };
  releaseReplaced({ replaced: saved.replaced, next, fetch });

  return { kind: "connected" };
}

/** Where the saved connection stands. Screens mount only on `verified`. */
export type HostCheck =
  | { readonly kind: "idle" }
  | { readonly kind: "verifying"; readonly saved: SavedConnection }
  | { readonly kind: "verified"; readonly saved: SavedConnection; readonly host: VerifiedHost }
  | {
      readonly kind: "failed";
      readonly saved: SavedConnection;
      readonly failure: Exclude<ConnectFailure, { kind: "cancelled" }>;
    };

/**
 * Verifies whatever the store holds, at launch and after every change. A
 * newer connection, a removal, or a retry aborts the verification before it,
 * whose answer is then dropped. A connection proven on its way in is adopted
 * without asking again.
 */
function createHostVerifier() {
  let check: HostCheck = { kind: "idle" };
  let running: AbortController | undefined;
  const listeners = new Set<() => void>();

  const publish = (next: HostCheck) => {
    check = next;

    for (const listener of listeners) listener();
  };

  const start = (saved: SavedConnection, repair: boolean) => {
    running?.abort();
    running = undefined;
    const cached = repair ? undefined : verified.get(saved);

    if (cached !== undefined) {
      publish({ kind: "verified", saved, host: cached });

      return;
    }

    const controller = new AbortController();
    running = controller;
    const timer = setTimeout(() => controller.abort(), RESUME_TIMEOUT_MS);
    publish({ kind: "verifying", saved });

    void verifyHost({ saved, repair, signal: controller.signal })
      .catch((cause: unknown) => ({
        kind: "unexpected" as const,
        detail: cause instanceof Error ? cause.message : String(cause),
      }))
      .then((result) => {
        clearTimeout(timer);

        if (running !== controller) return;
        running = undefined;
        // Only the timer aborts the current attempt, so an abort here is silence.
        const timedOut = controller.signal.aborted || result.kind === "cancelled";
        publish(
          timedOut
            ? {
                kind: "failed",
                saved,
                failure: { kind: "silent", address: displayAddress(saved.connection) },
              }
            : result.kind === "verified"
              ? { kind: "verified", saved, host: result.host }
              : { kind: "failed", saved, failure: result },
        );
      });
  };

  const sync = () => {
    const snapshot = connectionStore.getSnapshot();
    const saved = snapshot.kind === "saved" ? snapshot.saved : undefined;

    if (check.kind !== "idle" && check.saved === saved) return;

    if (saved !== undefined) {
      start(saved, false);

      return;
    }

    running?.abort();
    running = undefined;

    if (check.kind !== "idle") publish({ kind: "idle" });
  };

  connectionStore.subscribe(sync);

  return {
    getSnapshot: () => check,
    subscribe: (listener: () => void) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    /** Ask the saved host again; `repair` replaces its pin after a fresh signature. */
    retry: (repair: boolean) => {
      if (check.kind === "failed") start(check.saved, repair);
    },
  };
}

export const hostVerifier = createHostVerifier();
