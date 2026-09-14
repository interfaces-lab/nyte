import { createContext, use, useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { NyteClient } from "@nyte-ai/client";
import { describeHostError, type Connection } from "./connection.ts";
import {
  createHostClient,
  forgetConnection,
  readConnection,
  saveConnection,
  verifyHost,
} from "./host.ts";

export type HostConnectionState =
  | { kind: "loading" }
  | { kind: "setup"; notice?: string }
  | { kind: "connected"; connection: Connection; client: NyteClient };

export type HostSession = {
  client: NyteClient;
  connection: Connection;
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

  async function connect(connection: Connection, signal: AbortSignal) {
    try {
      await verifyHost(connection, signal);
    } catch (cause) {
      throw new Error(describeHostError(cause));
    }
    if (signal.aborted) throw new Error("Connection cancelled.");
    try {
      await saveConnection(connection);
    } catch {
      throw new Error("Couldn't save the token in the Keychain. Try again.");
    }
    if (signal.aborted) {
      await forgetConnection();
      throw new Error("Connection cancelled.");
    }
    setHost({ kind: "connected", connection, client: createHostClient(connection) });
  }

  async function disconnect() {
    await forgetConnection();
    setHost({ kind: "setup" });
  }

  return { host, connect, disconnect };
}
