import { createContext, use, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { Connection as HostConnection } from "@nyte-ai/sdk";
import { fetch } from "expo/fetch";
import type { Connection, SavedConnection } from "./connection.ts";
import type { ConnectFailure } from "./connect-copy.ts";
import { connectionStore, hostVerifier } from "./host.ts";
import { releaseCopy } from "../account/account-copy.ts";
import { useAccount } from "../account/account-provider.tsx";
import { RELEASE_TIMEOUT_MS, releaseOnHost } from "../account/revocation.ts";
import { toast } from "../ui/toast.tsx";
import { useMountEffect } from "../use-mount-effect.ts";

type HostTarget = {
  saved: SavedConnection;
  connection: Connection;
  client: HostConnection;
  scope: string;
  key: string;
};

export type HostRecovery = {
  readonly saved: SavedConnection;
  readonly failure: Exclude<ConnectFailure, { kind: "cancelled" }>;
  readonly retry: () => void;
  readonly repair: (() => void) | undefined;
  readonly disconnect: () => Promise<void>;
};

type HostConnectionState =
  | { kind: "loading" }
  | { kind: "setup"; notice?: string }
  | { kind: "recovery"; recovery: HostRecovery }
  | ({ kind: "connected" } & HostTarget);

export type HostSession = {
  readonly client: HostConnection;
  readonly connection: Connection;
  readonly saved: SavedConnection;
  readonly scope: string;
  readonly disconnect: () => Promise<void>;
};

const HostContext = createContext<HostSession | undefined>(undefined);

export function useHost(): HostSession {
  const host = use(HostContext);

  if (host === undefined) throw new Error("The host connection is not available.");

  return host;
}

export function HostProvider({ session, children }: { session: HostSession; children: ReactNode }) {
  return <HostContext.Provider value={session}>{children}</HostContext.Provider>;
}

export function useHostConnection() {
  // The Keychain read is the app's only boot fetch. The store, not a query
  // cache, holds the result, because it carries the bearer.
  const snapshot = useSyncExternalStore(connectionStore.subscribe, connectionStore.getSnapshot);
  const check = useSyncExternalStore(hostVerifier.subscribe, hostVerifier.getSnapshot);
  useMountEffect(() => {
    void connectionStore.load();
  });

  const account = useAccount();
  const ownerId = account?.status.kind === "signedIn" ? account.status.ownerId : undefined;
  const stored = snapshot.kind === "saved" ? snapshot.saved : undefined;
  const foreign =
    stored?.kind === "managed" && ownerId !== undefined && ownerId !== stored.binding.ownerId;
  const saved = foreign ? undefined : stored;

  const current = check.kind !== "idle" && check.saved === saved ? check : undefined;

  const target: HostTarget | undefined =
    saved === undefined || current?.kind !== "verified"
      ? undefined
      : {
          saved,
          connection: saved.connection,
          client: current.host.connection,
          scope: current.host.scope,
          key: current.host.key,
        };

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

    if (removed?.released !== undefined)
      toast.show(
        "Disconnected",
        releaseCopy(removed.saved.connection.name, { host: removed.released, broker: "skipped" }),
      );
  }

  const host: HostConnectionState =
    snapshot.kind === "loading"
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

  return { host, disconnect };
}
