import { createContext, use, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { AppState } from "react-native";
import { skipToken, useQuery } from "@tanstack/react-query";
import type { Connection as HostConnection } from "@nyte-ai/sdk";
import Constants from "expo-constants";
import { fetch } from "expo/fetch";
import { gt, valid } from "semver";
import type { Connection, SavedConnection } from "./connection.ts";
import type { ConnectFailure } from "./connect-copy.ts";
import { connectionStore, hostVerifier } from "./host.ts";
import { useHealth } from "./live.ts";
import type { LiveHost } from "./live.ts";
import { releaseCopy } from "../account/account-copy.ts";
import { useAccount } from "../account/account-provider.tsx";
import { RELEASE_TIMEOUT_MS, releaseOnHost } from "../account/revocation.ts";
import { toast } from "../ui/toast.tsx";
import { useMountEffect } from "../use-mount-effect.ts";

type HostTarget = {
  saved: SavedConnection;
  connection: Connection;
  client: HostConnection;
  live: LiveHost;
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
  readonly live: LiveHost;
  readonly connection: Connection;
  readonly saved: SavedConnection;
  readonly scope: string;
  readonly disconnect: () => Promise<void>;
};

/** A session as screens see it, with whether the host runs a newer Nyte than this app. */
export type ConnectedHost = HostSession & { readonly newerHost: boolean };

const HostContext = createContext<ConnectedHost | undefined>(undefined);

export function useHost(): ConnectedHost {
  const host = use(HostContext);

  if (host === undefined) throw new Error("The host connection is not available.");

  return host;
}

/** Reads the host's Nyte version each time its connection opens, since the Mac updating restarts it, and wakes the connection when the app comes forward. */
export function HostProvider({ session, children }: { session: HostSession; children: ReactNode }) {
  const health = useHealth(session.live);
  useMountEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") session.live.wake();
    });

    return () => subscription.remove();
  });

  const opened = health.kind === "open" ? health.since : undefined;

  const version = useQuery({
    queryKey: ["host-version", session.scope, opened],
    queryFn: opened === undefined ? skipToken : () => readVersion(session.client),
    placeholderData: (previous) => previous,
  });

  const host = valid(version.data);
  const app = valid(Constants.expoConfig?.version);
  const newerHost = host !== null && app !== null && gt(host, app);

  return <HostContext.Provider value={{ ...session, newerHost }}>{children}</HostContext.Provider>;
}

/** The saved connection and its host check. The Keychain read is the app's only boot fetch; the store, not a query cache, holds it because it carries the bearer. */
export function useHostConnection() {
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
          live: current.host.live,
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

async function readVersion(client: HostConnection): Promise<string | null> {
  for await (const view of client.watch()) return view.version;

  return null;
}
