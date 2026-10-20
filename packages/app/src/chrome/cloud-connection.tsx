import { props } from "@stylexjs/stylex";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactElement } from "react";
import { toast } from "@nyte-ai/ui/toast";
import type { ServerState } from "../bridge.ts";
import { Icon } from "@nyte-ai/ui/icon";
import { Button } from "@nyte-ai/ui/button";
import { Input } from "@nyte-ai/ui/input";
import { MenuItem, MenuSeparator } from "@nyte-ai/ui/menu";
import { nyte } from "../nyte.ts";
import { keys, useServerState } from "../queries.ts";
import { ConnectionMenu, ConnectionRow, type ConnectionStanding } from "./connection-list.tsx";
import { modelsSettingsStyles as styles } from "./models-settings.stylex.ts";
import { text } from "@nyte-ai/ui/styles/text.stylex";

function ConnectForm({
  pending,
  onSubmit,
  onCancel,
}: {
  pending: boolean;
  onSubmit: (input: { baseUrl: string; token: string }) => void;
  onCancel: (() => void) | undefined;
}): ReactElement {
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const ready = baseUrl.trim() !== "" && token.trim() !== "";

  return (
    <form
      {...props(styles.keyForm)}
      onSubmit={(event) => {
        event.preventDefault();

        if (!pending && ready) onSubmit({ baseUrl: baseUrl.trim(), token: token.trim() });
      }}
    >
      <div {...props(styles.keyRow)}>
        <Input
          variant="code"
          type="url"
          aria-label="Server URL"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://nyte-server.example.com"
          value={baseUrl}
          disabled={pending}
          xstyle={styles.keyInput}
          onValueChange={setBaseUrl}
        />
      </div>
      <div {...props(styles.keyRow)}>
        <Input
          variant="code"
          type="password"
          aria-label="Server token"
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste the server's NYTE_TOKEN"
          value={token}
          disabled={pending}
          xstyle={styles.keyInput}
          onValueChange={setToken}
        />
        <Button type="submit" variant="solid" tone="primary" loading={pending} disabled={!ready}>
          Connect Server
        </Button>
        {onCancel !== undefined && (
          <Button variant="outline" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      <span {...props(text.sm, styles.keyHint)}>Stored on this Mac in ~/.nyte/server.json.</span>
    </form>
  );
}

const checking: ConnectionStanding = { tone: "warn", status: "Checking…" };

function serverStanding(state: Exclude<ServerState, { kind: "none" }>): ConnectionStanding {
  if (state.kind === "unavailable") {
    return {
      tone: "err",
      status: state.problem.kind === "authentication" ? "Access required" : "Unavailable",
    };
  }

  return { tone: "on", status: "Connected" };
}

function serverDetail(state: Exclude<ServerState, { kind: "none" }>): string {
  if (state.kind === "unavailable") return state.problem.message;

  return `Nyte ${state.version}.`;
}

export function CloudConnection({ active }: { readonly active: boolean }): ReactElement {
  const client = useQueryClient();
  const server = useServerState(active);
  const [editing, setEditing] = useState(false);

  const connect = useMutation({
    mutationFn: (input: { baseUrl: string; token: string }) => nyte.host.server.connect(input),
    onSuccess: (outcome) => {
      if (outcome.kind === "failed") {
        toast.add({
          type: "error",
          title: `Couldn't reach the server: ${outcome.message}`,
          id: "server-connect",
        });

        return;
      }

      setEditing(false);
      toast.add({
        type: "success",
        title: `Connected to ${outcome.baseUrl} (v${outcome.version})`,
        id: "server-connect",
      });
    },
    onError: () =>
      toast.add({ type: "error", title: "Couldn't reach the server.", id: "server-connect" }),
    onSettled: () => client.invalidateQueries({ queryKey: keys.server }),
  });

  const disconnect = useMutation({
    mutationFn: () => nyte.host.server.disconnect(),
    onSettled: () => client.invalidateQueries({ queryKey: keys.server }),
  });

  const state = server.data;
  const pending = connect.isPending || disconnect.isPending;

  const form = (
    <ConnectForm
      pending={connect.isPending}
      onSubmit={(input) => connect.mutate(input)}
      onCancel={state !== undefined && state.kind !== "none" ? () => setEditing(false) : undefined}
    />
  );

  return (
    <>
      {state === undefined ? (
        <ConnectionRow glyph={<Icon name="cloud" size={16} />} title="Server" detail="Checking…" />
      ) : state.kind === "none" ? (
        <ConnectionRow
          glyph={<Icon name="cloud" size={16} />}
          title="Not connected"
          detail="Deploy packages/demo/server, then paste its URL and token."
          expansion={form}
        />
      ) : (
        <ConnectionRow
          glyph={<Icon name="cloud" size={16} />}
          title={state.baseUrl}
          detail={serverDetail(state)}
          control={
            <ConnectionMenu
              label="Server"
              {...(server.isFetching ? checking : serverStanding(state))}
              loading={disconnect.isPending}
              disabled={connect.isPending}
            >
              <MenuItem
                disabled={pending || server.isFetching}
                onClick={() => void server.refetch()}
              >
                Check Connection
              </MenuItem>
              <MenuItem onClick={() => setEditing(true)}>Change Connection…</MenuItem>
              <MenuSeparator />
              <MenuItem variant="danger" onClick={() => disconnect.mutate()}>
                Disconnect Server
              </MenuItem>
            </ConnectionMenu>
          }
          expansion={editing ? form : undefined}
        />
      )}
    </>
  );
}
