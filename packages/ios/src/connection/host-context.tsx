import { createContext, use, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { NyteClient } from "@nyte-ai/client";
import type { Connection } from "./connection.ts";
import type { ConnectFailure } from "./connect-copy.ts";
import { connectHost, createHostClient, forgetConnection, readConnection } from "./host.ts";

type HostConnectionState =
  | { kind: "loading" }
  // `editing` carries the live session the form replaces, so Cancel restores it.
  | { kind: "setup"; notice?: string; editing?: HostTarget }
  | ({ kind: "connected" } & HostTarget);

type HostTarget = { connection: Connection; client: NyteClient };

type HostSession = {
  client: NyteClient;
  connection: Connection;
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

/** Owns the saved-connection lifecycle above the router: restore, verify, forget. */
export function useHostConnection() {
  const [host, setHost] = useState<HostConnectionState>({ kind: "loading" });
  useEffect(() => {
    let mounted = true;
    void readConnection()
      .then((connection) => {
        if (mounted)
          setHost(
            connection
              ? { kind: "connected", connection, client: createHostClient(connection) }
              : { kind: "setup" },
          );
      })
      .catch(() => {
        if (mounted)
          setHost({ kind: "setup", notice: "Connect your Mac again to restore access." });
      });
    return () => {
      mounted = false;
    };
  }, []);

  /** Undefined means connected. A failure stays itself, so no `catch` can rename it. */
  async function connect(
    connection: Connection,
    signal: AbortSignal,
  ): Promise<ConnectFailure | undefined> {
    const result = await connectHost(connection, signal);
    if (result.kind !== "connected") return result;
    setHost({ kind: "connected", connection, client: createHostClient(connection) });
    return undefined;
  }

  /** Re-opens the form on the saved details. The token stays until one replaces it. */
  function edit() {
    setHost((current) =>
      current.kind === "connected"
        ? { kind: "setup", editing: { connection: current.connection, client: current.client } }
        : current,
    );
  }

  function cancelEdit() {
    setHost((current) =>
      current.kind === "setup" && current.editing !== undefined
        ? { kind: "connected", ...current.editing }
        : current,
    );
  }

  async function disconnect() {
    await forgetConnection();
    setHost({ kind: "setup" });
  }

  return { host, connect, edit, cancelEdit, disconnect };
}
