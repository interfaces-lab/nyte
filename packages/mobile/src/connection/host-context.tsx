import { createContext, use, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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

/** Owns the saved-connection lifecycle above the router: restore and forget. */
export function useHostConnection() {
  const queryClient = useQueryClient();

  // The Keychain read is the app's only boot fetch; nothing else writes it.
  // `null` stands in for "not saved" because setQueryData treats `undefined` as a bail-out.
  const saved = useQuery({
    queryKey: ["connection"],
    queryFn: async () => (await readConnection()) ?? null,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  const [form, setForm] = useState<{ notice?: string; editing?: Connection } | undefined>(
    undefined,
  );

  const client = useMemo(
    () => (saved.data == null ? undefined : createHostClient(saved.data)),
    [saved.data],
  );

  const host: HostConnectionState =
    form !== undefined
      ? {
          kind: "setup",
          notice: form.notice,
          editing:
            form.editing !== undefined && client !== undefined
              ? { connection: form.editing, client }
              : undefined,
        }
      : saved.isPending
        ? { kind: "loading" }
        : saved.isError
          ? { kind: "setup", notice: "Connect your Mac again to restore access." }
          : saved.data != null && client !== undefined
            ? { kind: "connected", connection: saved.data, client }
            : { kind: "setup" };

  /** Undefined means connected. A failure stays itself, so no `catch` can rename it. */
  async function connect(
    connection: Connection,
    signal: AbortSignal,
  ): Promise<ConnectFailure | undefined> {
    const result = await connectHost(connection, signal);

    if (result.kind !== "connected") return result;
    queryClient.setQueryData(["connection"], connection);
    setForm(undefined);

    return undefined;
  }

  /** Re-opens the form on the saved details. The token stays until one replaces it. */
  function edit() {
    setForm(saved.data == null ? undefined : { editing: saved.data });
  }

  function cancelEdit() {
    setForm(undefined);
  }

  async function disconnect() {
    await forgetConnection();
    queryClient.setQueryData(["connection"], null);
    setForm(undefined);
  }

  return { host, connect, edit, cancelEdit, disconnect };
}
