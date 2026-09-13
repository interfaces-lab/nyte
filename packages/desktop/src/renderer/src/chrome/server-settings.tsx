/**
 * Settings › Server has two connections that point opposite ways. The Server
 * row is outbound: a remote Nyte host this desktop reaches, whose sessions
 * appear under Cloud and run with the server's keys. The iOS row is inbound:
 * this desktop serving one of its own local stores, on loopback, to the iOS
 * app in a simulator on this Mac. Nothing here touches local providers.
 */
import { Input } from "@nyte-ai/ui";
import * as stylex from "@stylexjs/stylex";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactElement } from "react";
import { toast } from "@nyte-ai/ui/sonner";
import { errorMessage } from "../../../shared/errors.ts";
import type { MobileShareState, ServerState } from "../../../shared/ipc.ts";
import { Icon } from "../components/icons.tsx";
import { Button, IconButton } from "../components/ui.tsx";
import { nyte } from "../nyte.ts";
import { keys, useMobileShareState, useServerState } from "../queries.ts";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import { t } from "../theme/vars.stylex.ts";
import { ConnectionList, ConnectionRow, ConnectionStatus } from "./connection-list.tsx";
import { modelsSettingsStyles as styles } from "./models-settings.stylex.ts";

const shareStyles = stylex.create({
  panel: { display: "flex", flexDirection: "column", gap: 8 },
  // One grid for both fields so the value boxes share a left edge and width.
  fields: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr) auto",
    alignItems: "center",
    columnGap: 8,
    rowGap: 6,
  },
  label: {
    color: t.textSecondary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
  },
  fieldActions: { display: "inline-flex", gap: 2 },
  // Selected whole so a click cannot grab half of a token or address.
  value: {
    boxSizing: "border-box",
    minWidth: 0,
    minHeight: 26,
    paddingInline: 8,
    paddingBlock: 4,
    borderRadius: t.radiusBase,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: t.strokeSecondary,
    backgroundColor: t.bgBase,
    color: t.textPrimary,
    fontFamily: t.fontMono,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    fontVariantNumeric: "tabular-nums",
    userSelect: "all",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
});

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

function serverDetail(state: Exclude<ServerState, { kind: "none" }>): string {
  if (state.kind === "unavailable") return state.problem.message;
  const host = state.info.host;
  if (host.kind === "unspecified")
    return "The server responds, but does not report its tools or history storage.";
  const persistence =
    host.persistence === "durable"
      ? "Chat history uses durable storage."
      : host.persistence === "ephemeral"
        ? "Chat history is temporary and can disappear when the server restarts."
        : "The server has not reported how chat history is stored.";
  return `${host.capabilities.workspace ? "Workspace tools available." : "Chat only."} ${persistence}`;
}

export function CloudServerSettings(): ReactElement {
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
      onCancel={state !== undefined && state.kind !== "none" ? () => setEditing(false) : undefined}
    />
  );

  return (
    <section {...stylex.props(settingsPatterns.section)}>
      <div {...stylex.props(settingsPatterns.sectionHeader)}>
        <h2 {...stylex.props(settingsPatterns.sectionTitle)}>Cloud</h2>
        <p {...stylex.props(settingsPatterns.sectionDescription)}>
          A Nyte server you deployed. Its chats appear under Cloud in the sidebar and run with the
          server's keys.
        </p>
      </div>
      <ConnectionList>
        {state === undefined ? (
          <ConnectionRow
            glyph={<Icon name="cloud" size={16} />}
            title="Server"
            detail={undefined}
            status={<ConnectionStatus tone="warn">Checking…</ConnectionStatus>}
          />
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
            status={
              <ConnectionStatus
                tone={server.isFetching ? "warn" : state.kind === "connected" ? "on" : "err"}
              >
                {server.isFetching
                  ? "Checking…"
                  : state.kind === "connected"
                    ? "Connected"
                    : state.problem.kind === "authentication"
                      ? "Access required"
                      : "Unavailable"}
              </ConnectionStatus>
            }
            actions={
              <>
                <Button
                  variant="ghost"
                  disabled={pending || server.isFetching}
                  onClick={() => void server.refetch()}
                >
                  Check connection
                </Button>
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

function CopyButton({ label, value }: { label: string; value: string }): ReactElement {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      compact
      icon={copied ? "checkmark" : "copy"}
      label={copied ? "Copied" : `Copy ${label.toLocaleLowerCase()}`}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(
          () => setCopied(true),
          () => {
            setCopied(false);
            toast.error(
              `Couldn't copy the ${label.toLocaleLowerCase()}. Select it and copy it yourself.`,
            );
          },
        );
      }}
    />
  );
}

function shareTargetLabel(
  target: Extract<MobileShareState, { kind: "sharing" }>["target"],
): string {
  return target.kind === "home" ? "Home" : target.workspace.name;
}

/** The address and token the simulator needs, with the token hidden until asked for. */
function SharePanel({ state }: { state: Extract<MobileShareState, { kind: "sharing" }> }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div {...stylex.props(shareStyles.panel)}>
      <div {...stylex.props(shareStyles.fields)}>
        <span {...stylex.props(shareStyles.label)}>Address</span>
        <code aria-label="Share address" {...stylex.props(shareStyles.value)}>
          {state.address}
        </code>
        <span {...stylex.props(shareStyles.fieldActions)}>
          <CopyButton label="Address" value={state.address} />
        </span>
        <span {...stylex.props(shareStyles.label)}>Token</span>
        <code aria-label="Share token" {...stylex.props(shareStyles.value)}>
          {revealed ? state.token : "••••••••••••••••"}
        </code>
        <span {...stylex.props(shareStyles.fieldActions)}>
          <CopyButton label="Token" value={state.token} />
          <IconButton
            compact
            icon="eye"
            label={revealed ? "Hide token" : "Reveal token"}
            aria-pressed={revealed}
            onClick={() => setRevealed((value) => !value)}
          />
        </span>
      </div>
      <span {...stylex.props(styles.deviceCodeNote)}>
        Enter these in the iOS app. Loopback only, so a physical phone can't reach it. The token is
        new for every share and never written to disk.
      </span>
    </div>
  );
}

function MobileShareSettings(): ReactElement {
  const client = useQueryClient();
  const share = useMobileShareState();
  const start = useMutation({
    mutationFn: () => nyte.host.mobile.start(),
    onError: (cause) =>
      toast.error(`Couldn't start sharing: ${errorMessage(cause)}`, { id: "mobile-share" }),
    onSettled: () => client.invalidateQueries({ queryKey: keys.mobileShare }),
  });
  const stop = useMutation({
    mutationFn: () => nyte.host.mobile.stop(),
    onError: (cause) =>
      toast.error(`Couldn't stop sharing: ${errorMessage(cause)}`, { id: "mobile-share" }),
    onSettled: () => client.invalidateQueries({ queryKey: keys.mobileShare }),
  });
  const state = share.data;
  const pending = start.isPending || stop.isPending;

  return (
    <section {...stylex.props(settingsPatterns.section)}>
      <div {...stylex.props(settingsPatterns.sectionHeader)}>
        <h2 {...stylex.props(settingsPatterns.sectionTitle)}>iOS Simulator</h2>
        <p {...stylex.props(settingsPatterns.sectionDescription)}>
          Serve the selected folder's chats to the Nyte iOS app in a simulator on this Mac. The
          phone sees the same conversations; runs still execute here.
        </p>
      </div>
      <ConnectionList>
        {state === undefined ? null : state.kind === "off" ? (
          <ConnectionRow
            glyph={<Icon name="phone" size={16} />}
            title="Not sharing"
            detail="Keeps serving the folder selected now, even after you switch folders."
            actions={
              <Button variant="primary" disabled={pending} onClick={() => start.mutate()}>
                {start.isPending ? "Starting…" : "Start sharing"}
              </Button>
            }
          />
        ) : (
          <ConnectionRow
            glyph={<Icon name="phone" size={16} />}
            title={`Sharing ${shareTargetLabel(state.target)}`}
            detail={state.target.kind === "home" ? undefined : state.target.workspace.path}
            status={<ConnectionStatus tone="on">Serving</ConnectionStatus>}
            actions={
              <Button variant="ghost" disabled={pending} onClick={() => stop.mutate()}>
                {stop.isPending ? "Stopping…" : "Stop sharing"}
              </Button>
            }
            expansion={<SharePanel state={state} />}
          />
        )}
      </ConnectionList>
    </section>
  );
}

export function ServerSettings(): ReactElement {
  return (
    <>
      <CloudServerSettings />
      <MobileShareSettings />
    </>
  );
}
