import { sdk, SdkError } from "@nyte-ai/sdk";
import type { Connection as HostConnection, CredentialSource } from "@nyte-ai/sdk";
import { fetch } from "expo/fetch";
import { deleteItemAsync, getItemAsync, setItemAsync } from "expo-secure-store";
import { createMMKV } from "react-native-mmkv";
import { displayAddress, type Connection, type SavedConnection } from "./connection.ts";
import { classifyConnectFailure, type ConnectFailure } from "./connect-copy.ts";
import { createConnectionStore } from "./connection-store.ts";
import { createJournal } from "./journal.ts";
import { createPinStore, pinRoute } from "./pins.ts";
import { readAccountConfig } from "../account/account-config.ts";
import { deviceCrypto } from "../account/device.ts";
import { releaseReplaced } from "../account/revocation.ts";

const STORAGE_KEY = "nyte.host";

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

const journals = createMMKV({ id: "nyte.journal" });

function hostFetch(saved: SavedConnection): typeof globalThis.fetch {
  return saved.kind === "managed"
    ? (input, init) => fetch(input, { ...init, credentials: "omit" })
    : (input, init) => fetch(input, init);
}

export interface VerifiedHost {
  readonly connection: HostConnection;
  readonly saved: SavedConnection;
  readonly scope: string;
  readonly key: string;
}

export type HostVerification =
  | { readonly kind: "verified"; readonly host: VerifiedHost }
  | ConnectFailure;

const verified = new WeakMap<SavedConnection, VerifiedHost>();

let adoptions = 0;

function withCredential(saved: SavedConnection, credential: CredentialSource): SavedConnection {
  if (credential.kind !== "token" || credential.token === saved.connection.token) return saved;

  return { ...saved, connection: { ...saved.connection, token: credential.token } };
}

export async function verifyHost(input: {
  readonly saved: SavedConnection;
  readonly credentials?: CredentialSource;
  readonly repair: boolean;
  readonly signal: AbortSignal;
}): Promise<HostVerification> {
  const { saved, signal } = input;
  const route = pinRoute(saved);
  const address = displayAddress(saved.connection);
  let pinned: string | undefined;

  try {
    pinned = await pins.read(route);
  } catch {
    return { kind: "keychain" };
  }

  if (signal.aborted) return { kind: "cancelled" };
  let connection: HostConnection;

  try {
    connection = await sdk.connect({
      url: saved.connection.url,
      credentials: input.credentials ?? { kind: "token", token: saved.connection.token },
      journal: createJournal(journals, JSON.stringify(route)),
      fetch: hostFetch(saved),
    });
  } catch (cause) {
    if (signal.aborted) return { kind: "cancelled" };

    if (cause instanceof SdkError) return classifyConnectFailure(cause, address);

    return { kind: "unexpected", detail: cause instanceof Error ? cause.message : String(cause) };
  }

  const refuse = (failure: ConnectFailure): ConnectFailure => {
    void connection.close();

    return failure;
  };

  if (signal.aborted) return refuse({ kind: "cancelled" });

  if (pinned !== undefined && pinned !== connection.hostId && !input.repair)
    return refuse({ kind: "identityChanged", address, url: saved.connection.url });

  if (pinned !== connection.hostId) {
    try {
      await pins.write(route, connection.hostId);
    } catch {
      return refuse({ kind: "keychain" });
    }
  }

  if (signal.aborted) return refuse({ kind: "cancelled" });

  const principal =
    saved.kind === "managed"
      ? ["device", saved.binding.ownerId, saved.binding.deviceId]
      : ["bearer"];

  adoptions += 1;

  const host: VerifiedHost = {
    connection,
    saved: withCredential(saved, connection.credential),
    scope: JSON.stringify(["host", connection.hostId, ...principal]),
    key: String(adoptions),
  };

  verified.set(host.saved, host);

  return { kind: "verified", host };
}

export type ConnectResult = { readonly kind: "connected" } | ConnectFailure;

export async function connectHost(input: {
  readonly connection: Connection;
  readonly repair: boolean;
  readonly signal: AbortSignal;
}): Promise<ConnectResult> {
  const { signal } = input;
  const { token } = input.connection;
  const current = connectionStore.getSnapshot();
  const kept = current.kind === "saved" && current.saved.connection.token === token;

  const result = await verifyHost({
    saved: { kind: "manual", connection: input.connection },
    credentials: kept ? { kind: "token", token } : { kind: "pairing", code: token },
    repair: input.repair,
    signal,
  });

  if (result.kind !== "verified") return result;
  const { saved: next, connection } = result.host;
  const saved = await connectionStore.save(next, signal);

  if (saved.kind !== "saved") void connection.close();

  if (saved.kind === "failed") return { kind: "notSaved" };

  if (saved.kind === "cancelled") return { kind: "cancelled" };
  releaseReplaced({ replaced: saved.replaced, next, fetch });

  return { kind: "connected" };
}

export type HostCheck =
  | { readonly kind: "idle" }
  | { readonly kind: "verifying"; readonly saved: SavedConnection }
  | { readonly kind: "verified"; readonly saved: SavedConnection; readonly host: VerifiedHost }
  | {
      readonly kind: "failed";
      readonly saved: SavedConnection;
      readonly failure: Exclude<ConnectFailure, { kind: "cancelled" }>;
    };

function createHostVerifier() {
  let check: HostCheck = { kind: "idle" };
  let running: AbortController | undefined;
  const listeners = new Set<() => void>();

  const publish = (next: HostCheck) => {
    if (
      check.kind === "verified" &&
      (next.kind !== "verified" || next.host.connection !== check.host.connection)
    )
      void check.host.connection.close();
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

        if (running !== controller) {
          if (result.kind === "verified") void result.host.connection.close();

          return;
        }

        running = undefined;
        const timedOut = controller.signal.aborted || result.kind === "cancelled";

        if (timedOut && result.kind === "verified") void result.host.connection.close();
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
    retry: (repair: boolean) => {
      if (check.kind === "failed") start(check.saved, repair);
    },
  };
}

export const hostVerifier = createHostVerifier();
