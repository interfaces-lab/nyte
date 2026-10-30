import { create, props } from "@stylexjs/stylex";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactElement } from "react";
import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Input } from "@nyte-ai/ui/input";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import type { ServerState } from "../bridge.ts";
import { errorMessage } from "../errors.ts";
import { nyte } from "../nyte.ts";
import { keys, useServerState } from "../queries.ts";
import { SettingsField, SettingsFormDialog } from "../settings/dialog.tsx";
import { SettingsSection } from "../settings/rows.tsx";
import { ConnectionStatus, FactRow } from "./connection-list.tsx";

const styles = create({
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.s1,
    paddingBlock: space.s8,
    paddingInline: space.s6,
    textAlign: "center",
  },
  emptyGlyph: { marginBlockEnd: space.s2, color: role.contentTertiary },
  emptyTitle: {
    color: role.contentPrimary,
    fontSize: type.fontBase,
    fontWeight: type.weightSemibold,
    lineHeight: type.leadingBase,
  },
  emptyBody: {
    maxWidth: "40ch",
    color: role.contentSecondary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    textWrap: "balance",
  },
});

const TITLE = "Remote host";

/** An https URL with a host. Anything after the host is kept, minus a trailing slash. */
function hostAddress(value: string): string | undefined {
  if (!URL.canParse(value)) return undefined;
  const url = new URL(value);

  if (url.protocol !== "https:" || url.hostname === "") return undefined;

  return value.replace(/\/+$/u, "");
}

function ConnectDialog({ onOpenChange }: { readonly onOpenChange: (open: boolean) => void }) {
  const client = useQueryClient();
  const [address, setAddress] = useState("");
  const [token, setToken] = useState("");
  const [tried, setTried] = useState(false);
  const baseUrl = hostAddress(address.trim());

  const connect = useMutation({
    mutationFn: (input: { baseUrl: string; token: string }) => nyte.host.server.connect(input),
    onSuccess: (outcome) => {
      if (outcome.kind === "connected") onOpenChange(false);
    },
    onSettled: () => client.invalidateQueries({ queryKey: keys.server }),
  });

  const failure =
    connect.data?.kind === "failed"
      ? `Couldn't reach the host: ${connect.data.message}`
      : connect.error === null
        ? undefined
        : `Couldn't reach the host: ${errorMessage(connect.error)}`;

  return (
    <SettingsFormDialog
      open
      title="Connect to Host"
      description="List another Nyte host's chats in the sidebar. A Mac shows its address and token under Pair… in Settings > Server."
      submitLabel="Connect"
      canSubmit={address.trim() !== "" && token.trim() !== ""}
      pending={connect.isPending}
      error={failure}
      onOpenChange={onOpenChange}
      onSubmit={() => {
        setTried(true);

        if (baseUrl !== undefined) connect.mutate({ baseUrl, token: token.trim() });
      }}
    >
      <SettingsField
        label="Address"
        error={
          tried && baseUrl === undefined
            ? "Addresses start with https://, like https://studio.example.ts.net."
            : undefined
        }
      >
        <Input
          variant="code"
          type="url"
          aria-label="Address"
          aria-invalid={tried && baseUrl === undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder="https://studio.example.ts.net"
          value={address}
          onValueChange={setAddress}
        />
      </SettingsField>
      <SettingsField label="Token" hint="Stored on this Mac in ~/.nyte/server.json.">
        <Input
          variant="code"
          type="password"
          aria-label="Token"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onValueChange={setToken}
        />
      </SettingsField>
    </SettingsFormDialog>
  );
}

function hostDetail(state: Exclude<ServerState, { kind: "none" }>, checking: boolean) {
  if (checking) return <ConnectionStatus tone="warn">Checking…</ConnectionStatus>;

  if (state.kind === "unavailable") {
    return (
      <>
        <ConnectionStatus tone="err">
          {state.problem.kind === "authentication" ? "Access required" : "Unavailable"}
        </ConnectionStatus>
        {` ${state.problem.message}`}
      </>
    );
  }

  return (
    <>
      <ConnectionStatus tone="on">Connected</ConnectionStatus>
      {` · Nyte ${state.version}`}
    </>
  );
}

/** The Remote host group: list another host's chats here, or stop. */
export function RemoteHost(): ReactElement {
  const client = useQueryClient();
  const server = useServerState();
  const [connecting, setConnecting] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const disconnect = useMutation({
    mutationFn: () => nyte.host.server.disconnect(),
    onSuccess: () => setConfirming(false),
    onSettled: () => client.invalidateQueries({ queryKey: keys.server }),
  });

  const state = server.data;

  return (
    <>
      <SettingsSection
        title={TITLE}
        actions={
          state?.kind === "none" ? (
            <Button variant="outline" onClick={() => setConnecting(true)}>
              Connect to Host…
            </Button>
          ) : undefined
        }
      >
        {state === undefined ? (
          <FactRow
            icon="server"
            title={TITLE}
            detail={server.isError ? errorMessage(server.error) : "Checking…"}
          />
        ) : state.kind === "none" ? (
          <div data-settings-row="" {...props(styles.empty)}>
            <span {...props(styles.emptyGlyph)}>
              <Icon name="globe" size={24} />
            </span>
            <span {...props(styles.emptyTitle)}>No Remote Host</span>
            <span {...props(styles.emptyBody)}>
              Connect to another Nyte host to list its chats in the sidebar.
            </span>
          </div>
        ) : (
          <FactRow
            icon="server"
            tone={state.kind === "connected" ? "on" : "neutral"}
            title={state.baseUrl}
            detail={hostDetail(state, server.isFetching)}
          >
            {state.kind === "unavailable" && (
              <Button
                variant="outline"
                disabled={server.isFetching}
                onClick={() => void server.refetch()}
              >
                Check Again
              </Button>
            )}
            <Button variant="outline" onClick={() => setConnecting(true)}>
              Change Host…
            </Button>
            <Button variant="outline" onClick={() => setConfirming(true)}>
              Disconnect…
            </Button>
          </FactRow>
        )}
      </SettingsSection>
      {connecting && <ConnectDialog onOpenChange={setConnecting} />}
      {state !== undefined && state.kind !== "none" && (
        <ConfirmDialog
          open={confirming}
          pending={disconnect.isPending}
          error={
            disconnect.error === null
              ? undefined
              : `Couldn't disconnect: ${errorMessage(disconnect.error)}`
          }
          title="Disconnect from this host?"
          description={`This Mac stops listing chats from ${state.baseUrl}. They keep running there.`}
          confirmLabel="Disconnect"
          pendingLabel="Disconnecting…"
          onOpenChange={(open) => {
            setConfirming(open);
            disconnect.reset();
          }}
          onConfirm={() => disconnect.mutate()}
        />
      )}
    </>
  );
}
