/**
 * Settings › Server: the one remote Nyte host this desktop reaches. Its
 * sessions appear in the sidebar's Cloud group; they run on the server with
 * the server's keys, so nothing here touches local providers.
 */
import { Input } from "@nyte-ai/ui";
import * as stylex from "@stylexjs/stylex";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactElement } from "react";
import { toast } from "@nyte-ai/ui/sonner";
import { Icon } from "../components/icons.tsx";
import { Button } from "../components/ui.tsx";
import { nyte } from "../nyte.ts";
import { keys, useServerState } from "../queries.ts";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import { ConnectionList, ConnectionRow, ConnectionStatus } from "./connection-list.tsx";
import { modelsSettingsStyles as styles } from "./models-settings.stylex.ts";

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
      {...stylex.props(styles.keyForm)}
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) onSubmit({ baseUrl: baseUrl.trim(), token: token.trim() });
      }}
    >
      <div {...stylex.props(styles.keyRow)}>
        <Input
          unstyled
          type="url"
          aria-label="Server URL"
          autoComplete="off"
          autoFocus
          spellCheck={false}
          placeholder="https://nyte-server.example.com"
          value={baseUrl}
          disabled={pending}
          {...stylex.props(styles.keyInput)}
          onChange={(event) => setBaseUrl(event.target.value)}
        />
      </div>
      <div {...stylex.props(styles.keyRow)}>
        <Input
          unstyled
          type="password"
          aria-label="Server token"
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste the server's NYTE_TOKEN"
          value={token}
          disabled={pending}
          {...stylex.props(styles.keyInput)}
          onChange={(event) => setToken(event.target.value)}
        />
        <Button type="submit" variant="primary" disabled={pending || !ready}>
          {pending ? "Connecting…" : "Connect"}
        </Button>
        {onCancel !== undefined && (
          <Button variant="ghost" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      <span {...stylex.props(styles.keyHint)}>
        Stored on this Mac in ~/.nyte/server.json. The desktop proves the token before saving it.
      </span>
    </form>
  );
}

export function ServerSettings(): ReactElement {
  const client = useQueryClient();
  const server = useServerState();
  const [editing, setEditing] = useState(false);
  const connect = useMutation({
    mutationFn: (input: { baseUrl: string; token: string }) => nyte.host.server.connect(input),
    onSuccess: (outcome) => {
      if (outcome.kind === "failed") {
        toast.error(`Couldn't reach the server: ${outcome.message}`, { id: "server-connect" });
        return;
      }
      setEditing(false);
      toast.success(`Connected to ${outcome.baseUrl} (v${outcome.version})`, {
        id: "server-connect",
      });
    },
    onError: () => toast.error("Couldn't reach the server.", { id: "server-connect" }),
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
      onCancel={state?.kind === "configured" ? () => setEditing(false) : undefined}
    />
  );

  return (
    <section {...stylex.props(settingsPatterns.section)}>
      <div {...stylex.props(settingsPatterns.sectionHeader)}>
        <h2 {...stylex.props(settingsPatterns.sectionTitle)}>Server</h2>
        <p {...stylex.props(settingsPatterns.sectionDescription)}>
          A Nyte host you deployed. Its chats show under Cloud and run with the server's keys.
        </p>
      </div>
      <ConnectionList>
        {state === undefined ? null : state.kind === "none" ? (
          <ConnectionRow
            glyph={<Icon name="cloud" size={16} />}
            title="No server"
            detail="Deploy one from packages/demo/server, then paste its URL and token."
            expansion={form}
          />
        ) : (
          <ConnectionRow
            glyph={<Icon name="cloud" size={16} />}
            title={state.baseUrl}
            detail="Chats created under Cloud live on this server."
            status={<ConnectionStatus tone="on">Connected</ConnectionStatus>}
            actions={
              <>
                <Button variant="ghost" disabled={pending} onClick={() => setEditing(true)}>
                  Change
                </Button>
                <Button variant="ghost" disabled={pending} onClick={() => disconnect.mutate()}>
                  Disconnect
                </Button>
              </>
            }
            expansion={editing ? form : undefined}
          />
        )}
      </ConnectionList>
    </section>
  );
}
