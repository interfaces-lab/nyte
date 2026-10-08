import { createContext, use, useMemo, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { NyteClient } from "@nyte-ai/client";
import type { ServerInfo } from "@nyte-ai/protocol";
import { fetch } from "expo/fetch";
import type { Connection, SavedConnection } from "./connection.ts";
import type { ConnectFailure } from "./connect-copy.ts";
import { connectHost, connectionStore, createHostClient, hostVerifier } from "./host.ts";
import { releaseCopy } from "../account/account-copy.ts";
import { useAccount } from "../account/account-provider.tsx";
import { RELEASE_TIMEOUT_MS, releaseOnHost } from "../account/revocation.ts";
import { toast } from "../ui/toast.tsx";
import { useMountEffect } from "../use-mount-effect.ts";

type HostTarget = {
  saved: SavedConnection;
  connection: Connection;
  client: NyteClient;
  info: ServerInfo;
  scope: string;
  /** Changes on every verified adoption: a new credential, host, or re-pair remounts. */
  key: string;
};

/** A saved host that did not verify, and the ways out of it. */
export type HostRecovery = {
  readonly saved: SavedConnection;
  readonly failure: Exclude<ConnectFailure, { kind: "cancelled" }>;
  readonly retry: () => void;
  /** Present when the host's identity changed: replace the pin after a fresh signature. */
  readonly repair: (() => void) | undefined;
  readonly disconnect: () => Promise<void>;
};

type HostConnectionState =
  | { kind: "loading" }
  // `editing` carries the live session the form replaces, so Cancel restores it.
  | { kind: "setup"; notice?: string; editing?: HostTarget }
  | { kind: "recovery"; recovery: HostRecovery }
  | ({ kind: "connected" } & HostTarget);

export type HostSession = {
  readonly client: NyteClient;
  readonly connection: Connection;
  readonly saved: SavedConnection;
  /**
   * `/v1/info` from the verification that admitted this mount. `info.identity`
   * is present only when the host signed a fresh nonce for this route's pin;
   * a cursor host without identity has none.
   */
  readonly info: ServerInfo;
  /**
   * The host and principal stored state belongs to, as a JSON tuple without
   * any bearer: `["host", hostId, …principal]` when proven, otherwise
   * `["address", url, bearerDigest, …principal]`. The principal is
   * `["bearer"]` or `["device", ownerId, deviceId]`.
   */
  readonly scope: string;
  readonly edit: () => void;
  readonly disconnect: () => Promise<void>;
};

const HostContext = createContext<HostSession | undefined>(undefined);

/** Screens below the connection gate always have a verified host client. */
export function useHost(): HostSession {
  const host = use(HostContext);

  if (host === undefined) throw new Error("The host connection is not available.");

  return host;
}

export function HostProvider({ session, children }: { session: HostSession; children: ReactNode }) {
  return <HostContext.Provider value={session}>{children}</HostContext.Provider>;
}

/** Owns the saved-connection lifecycle above the router: restore, verify and forget. */
export function useHostConnection() {
  // The Keychain read is the app's only boot fetch. The store, not a query
  // cache, holds the result, because it carries the bearer.
  const snapshot = useSyncExternalStore(connectionStore.subscribe, connectionStore.getSnapshot);
  const check = useSyncExternalStore(hostVerifier.subscribe, hostVerifier.getSnapshot);
  useMountEffect(() => {
    void connectionStore.load();
  });

  // The connection the form was opened over. Saving any other one, through
  // the form or a Nyte account, closes it.
  const [editing, setEditing] = useState<SavedConnection | undefined>(undefined);
  const account = useAccount();
  const ownerId = account?.status.kind === "signedIn" ? account.status.ownerId : undefined;
  const stored = snapshot.kind === "saved" ? snapshot.saved : undefined;
  // Once Clerk names someone else, another account's host is never served, even
  // before or without its removal from the Keychain. Signed out, it keeps working.
  const foreign =
    stored?.kind === "managed" && ownerId !== undefined && ownerId !== stored.binding.ownerId;
  const saved = foreign ? undefined : stored;
  const client = useMemo(
    () => (saved === undefined ? undefined : createHostClient(saved)),
    [saved],
  );

  // The verifier follows the same store, so a check for another connection is not this one's.
  const current = check.kind !== "idle" && check.saved === saved ? check : undefined;

  const target: HostTarget | undefined =
    saved === undefined || client === undefined || current?.kind !== "verified"
      ? undefined
      : {
          saved,
          connection: saved.connection,
          client,
          info: current.host.info,
          scope: current.host.scope,
          key: current.host.key,
        };

  /**
   * Undefined means connected. A failure stays itself, so no `catch` can rename
   * it. `repair` replaces this address's pinned host after a fresh signature.
   */
  async function connect(
    connection: Connection,
    signal: AbortSignal,
    repair: boolean,
  ): Promise<ConnectFailure | undefined> {
    const result = await connectHost({ connection, repair, signal });

    if (result.kind !== "connected") return result;
    setEditing(undefined);

    return undefined;
  }

  /** Re-opens the form on the saved details. The token stays until one replaces it. */
  function edit() {
    setEditing(saved);
  }

  function cancelEdit() {
    setEditing(undefined);
  }

  /**
   * Forgets the saved connection. An account-enrolled one first asks its host
   * to drop this device; the Nyte sign-in and the host's pin are left alone.
   */
  async function disconnect() {
    const removing = saved;

    if (removing === undefined) return;
    const removed = await connectionStore.remove({
      match: (candidate): candidate is SavedConnection => candidate === removing,
      release: (candidate) =>
        candidate.kind === "managed"
          ? releaseOnHost({
              connection: candidate.connection,
              fetch,
              timeoutMs: RELEASE_TIMEOUT_MS,
            })
          : Promise.resolve(undefined),
    });

    setEditing(undefined);

    if (removed?.released !== undefined)
      toast.show(
        "Disconnected",
        releaseCopy(removed.saved.connection.name, { host: removed.released, broker: "skipped" }),
      );
  }

  const host: HostConnectionState =
    editing !== undefined && editing === saved
      ? { kind: "setup", editing: target }
      : snapshot.kind === "loading"
        ? { kind: "loading" }
        : snapshot.kind === "unknown"
          ? { kind: "setup", notice: "Connect your computer again to restore access." }
          : foreign
            ? { kind: "setup", notice: "Your saved computer belongs to another Nyte account." }
            : saved === undefined
              ? { kind: "setup" }
              : target !== undefined
                ? { kind: "connected", ...target }
                : current?.kind === "failed"
                  ? {
                      kind: "recovery",
                      recovery: {
                        saved,
                        failure: current.failure,
                        retry: () => hostVerifier.retry(false),
                        repair:
                          current.failure.kind === "identityChanged"
                            ? () => hostVerifier.retry(true)
                            : undefined,
                        disconnect,
                      },
                    }
                  : { kind: "loading" };

  return { host, connect, edit, cancelEdit, disconnect };
}
