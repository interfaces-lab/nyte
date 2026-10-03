import { createContext, use, useMemo, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { NyteClient } from "@nyte-ai/client";
import { fetch } from "expo/fetch";
import type { Connection, SavedConnection } from "./connection.ts";
import type { ConnectFailure } from "./connect-copy.ts";
import { connectHost, connectionStore, createHostClient } from "./host.ts";
import { releaseCopy } from "../account/account-copy.ts";
import { useAccount } from "../account/account-provider.tsx";
import { RELEASE_TIMEOUT_MS, releaseOnHost } from "../account/revocation.ts";
import { toast } from "../ui/toast.tsx";
import { useMountEffect } from "../use-mount-effect.ts";

type HostTarget = {
  saved: SavedConnection;
  connection: Connection;
  client: NyteClient;
  /** Changes whenever the target does, including a new device on the same Mac. */
  key: string;
};

type HostConnectionState =
  | { kind: "loading" }
  // `editing` carries the live session the form replaces, so Cancel restores it.
  | { kind: "setup"; notice?: string; editing?: HostTarget }
  | ({ kind: "connected" } & HostTarget);

export type HostSession = {
  client: NyteClient;
  connection: Connection;
  saved: SavedConnection;
  edit: () => void;
  disconnect: () => Promise<void>;
};

const HostContext = createContext<HostSession | undefined>(undefined);

/** Screens below the connection gate always have a live host client. */
export function useHost(): HostSession {
  const host = use(HostContext);

  if (host === undefined) throw new Error("The host connection is not available.");

  return host;
}

export function HostProvider({ session, children }: { session: HostSession; children: ReactNode }) {
  return <HostContext.Provider value={session}>{children}</HostContext.Provider>;
}

/** Owns the saved-connection lifecycle above the router: restore and forget. */
export function useHostConnection() {
  // The Keychain read is the app's only boot fetch. The store, not a query
  // cache, holds the result, because it carries the bearer.
  const snapshot = useSyncExternalStore(connectionStore.subscribe, connectionStore.getSnapshot);
  useMountEffect(() => {
    void connectionStore.load();
  });

  // The connection the form was opened over. Saving any other one, through
  // the form or a Nyte account, closes it.
  const [editing, setEditing] = useState<SavedConnection | undefined>(undefined);
  const account = useAccount();
  const ownerId = account?.status.kind === "signedIn" ? account.status.ownerId : undefined;
  const stored = snapshot.kind === "saved" ? snapshot.saved : undefined;
  // Once Clerk names someone else, another account's Mac is never served, even
  // before or without its removal from the Keychain. Signed out, it keeps working.
  const foreign =
    stored?.kind === "managed" && ownerId !== undefined && ownerId !== stored.binding.ownerId;
  const saved = foreign ? undefined : stored;
  const client = useMemo(
    () => (saved === undefined ? undefined : createHostClient(saved)),
    [saved],
  );

  const target: HostTarget | undefined =
    saved === undefined || client === undefined
      ? undefined
      : {
          saved,
          connection: saved.connection,
          client,
          key:
            saved.kind === "managed"
              ? `${saved.connection.url} ${saved.binding.deviceId}`
              : saved.connection.url,
        };

  const host: HostConnectionState =
    editing !== undefined && editing === saved
      ? { kind: "setup", editing: target }
      : snapshot.kind === "loading"
        ? { kind: "loading" }
        : snapshot.kind === "unknown"
          ? { kind: "setup", notice: "Connect your Mac again to restore access." }
          : foreign
            ? { kind: "setup", notice: "Your saved Mac belongs to another Nyte account." }
            : target !== undefined
              ? { kind: "connected", ...target }
              : { kind: "setup" };

  /** Undefined means connected. A failure stays itself, so no `catch` can rename it. */
  async function connect(
    connection: Connection,
    signal: AbortSignal,
  ): Promise<ConnectFailure | undefined> {
    const result = await connectHost(connection, signal);

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
   * Forgets the saved connection. An account-enrolled one first asks its Mac
   * to drop this device; the Nyte sign-in is left alone.
   */
  async function disconnect() {
    const current = saved;

    if (current === undefined) return;
    const removed = await connectionStore.remove({
      match: (candidate): candidate is SavedConnection => candidate === current,
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

  return { host, connect, edit, cancelEdit, disconnect };
}
