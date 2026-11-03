import { focusManager, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import { Button } from "@nyte-ai/ui/button";
import { toast } from "@nyte-ai/ui/toast";
import type { TailnetStatus } from "@nyte-ai/schema";
import { errorMessage } from "../contract/errors.ts";
import type { RemoteAccessState, RemoteReach, TailnetNode } from "../contract/bridge.ts";
import { nyte } from "../contract/nyte.ts";
import { keys } from "../data/query-client.ts";
import { useRemoteAccessState } from "../data/host.ts";
import { SettingsRow, SettingsSection, SettingsSwitchRow } from "../settings/rows.tsx";
import { props } from "@stylexjs/stylex";
import { useConnectView } from "../account/connect-view.ts";
import { FactRow } from "../components/connection-list.tsx";
import { NyteConnection } from "./nyte-connection.tsx";
import { CopyButton, shareStyles } from "./remote-share.tsx";
import { CloudflareSection, TunnelPairButton } from "./remote-tunnel.tsx";

type Serving = Extract<RemoteAccessState, { kind: "serving" }>;

function AddressSection({ state }: { readonly state: Serving }): ReactElement {
  return (
    <SettingsSection>
      <SettingsRow title="Remote address" description={state.address} controlWidth="wide">
        <span {...props(shareStyles.actions)}>
          <CopyButton label="Address" value={state.address} />
          {state.cloudflare.kind === "configured" ? (
            <TunnelPairButton tunnel={state.cloudflare} />
          ) : null}
        </span>
      </SettingsRow>
    </SettingsSection>
  );
}

function tailnetName(node: TailnetNode): string | undefined {
  return node.state === "running" ? node.dnsName?.replace(/\.$/, "") : undefined;
}

function tailnetDetail(node: TailnetNode): string {
  switch (node.state) {
    case "unavailable":
      return "This Mac's Nyte host has no Tailscale node. Reinstall Nyte to get it back.";
    case "disabled":
      return "Off";
    case "starting":
      return "Starting…";
    case "needs_login":
      return node.authUrl === undefined
        ? "Waiting for a Tailscale sign-in link…"
        : `Sign in to Tailscale to add this Mac to your tailnet: ${node.authUrl}`;
    case "needs_machine_approval":
      return "Signed in. An admin of your tailnet has to approve this Mac in the Tailscale admin console.";
    case "running": {
      const name = tailnetName(node) ?? "this Mac";

      return node.https === "available"
        ? `Running at https://${name}`
        : `Running as ${name}. Turn on HTTPS certificates in the Tailscale admin console to pair devices.`;
    }

    case "stopped":
      return `Stopped. ${stoppedReason(node)}`;
    default: {
      const _exhaustive: never = node;

      return _exhaustive;
    }
  }
}

function stoppedReason(node: TailnetStatus): string {
  switch (node.reason) {
    case "locked":
      return node.holder === undefined
        ? "Another process on this Mac runs Nyte's Tailscale node."
        : `Another process on this Mac (pid ${String(node.holder)}) runs Nyte's Tailscale node.`;
    case "protocol":
      return "This Nyte host and its Tailscale node don't speak the same protocol. Reinstall Nyte.";
    case "version":
      return "This Nyte host and its Tailscale node are different versions. Reinstall Nyte.";
    case "hello_timeout":
      return "The Tailscale node didn't answer in time. Nyte restarts it.";
    case "start_timeout":
      return "The Tailscale node didn't connect to your tailnet in time. Nyte restarts it.";
    case "invalid_status":
      return "The Tailscale node sent a status Nyte can't read. Nyte restarts it.";
    case "exited":
    case undefined:
      return `${node.detail ?? "The Tailscale node exited."} Nyte restarts it.`;
    default: {
      const _exhaustive: never = node.reason;

      return _exhaustive;
    }
  }
}

function TailscaleSection({
  node,
  pending,
  onEnabled,
  onSignOut,
}: {
  readonly node: TailnetNode;
  readonly pending: boolean;
  readonly onEnabled: (enabled: boolean) => void;
  readonly onSignOut: () => void;
}): ReactElement {
  const enabled = node.state !== "disabled" && node.state !== "unavailable";
  const name = tailnetName(node);

  return (
    <SettingsSection
      title="Tailscale"
      note="This Mac joins your tailnet as a device of its own. Devices of yours on the tailnet reach it there; no token leaves this Mac."
    >
      <FactRow
        icon="devices"
        tone={node.state === "running" ? "on" : "neutral"}
        title="Tailscale node"
        detail={tailnetDetail(node)}
      >
        {node.state === "needs_login" && node.authUrl !== undefined && (
          <Button
            variant="solid"
            tone="primary"
            onClick={() => {
              if (node.authUrl !== undefined) void nyte.host.openExternal({ url: node.authUrl });
            }}
          >
            Sign In…
          </Button>
        )}
        {enabled && node.state !== "needs_login" && (
          <Button variant="outline" disabled={pending} onClick={onSignOut}>
            Sign Out
          </Button>
        )}
      </FactRow>
      {name !== undefined && node.state === "running" && node.https === "available" && (
        <SettingsRow title="Remote address" description={`https://${name}`} controlWidth="wide">
          <CopyButton label="Address" value={`https://${name}`} />
        </SettingsRow>
      )}
      <SettingsSwitchRow
        title="Serve over Tailscale"
        description="Runs Nyte's own Tailscale node beside its host"
        checked={enabled}
        disabled={pending || node.state === "unavailable"}
        onCheckedChange={onEnabled}
      />
    </SettingsSection>
  );
}

function sharedDetail(reaches: readonly string[], state: RemoteAccessState | undefined): string {
  const over = `Shared over ${reaches.join(" and ")}`;

  return state?.kind === "serving" && state.target.kind === "project"
    ? `${over} · Starts in ${state.target.workspace.name}`
    : over;
}

/**
 * How other devices reach this Mac: its status, the address to pair with, Tailscale, Cloudflare
 * Tunnel and the Nyte account. Tailscale and Cloudflare Tunnel serve one at a time.
 */
export function RemoteAccess({ active }: { readonly active: boolean }): ReactElement {
  const client = useQueryClient();
  const remote = useRemoteAccessState(active);
  const account = useConnectView(nyte.host.connect).data;
  const [confirming, setConfirming] = useState(false);

  const start = useMutation({
    mutationFn: (reach: RemoteReach) => nyte.host.remote.start({ reach }),
    onError: (cause) =>
      toast.add({
        type: "error",
        title: `Couldn't serve over Cloudflare Tunnel: ${errorMessage(cause)}`,
        id: "remote-access",
      }),
    onSettled: () => client.invalidateQueries({ queryKey: keys.remoteAccess }),
  });

  const stop = useMutation({
    mutationFn: () => nyte.host.remote.stop(),
    onError: (cause) =>
      toast.add({
        type: "error",
        title: `Couldn't stop serving: ${errorMessage(cause)}`,
        id: "remote-access",
      }),
    onSettled: () => client.invalidateQueries({ queryKey: keys.remoteAccess }),
  });

  const tailnet = useMutation({
    mutationFn: (enabled: boolean) => nyte.host.remote.configureTailnet({ enabled }),
    onError: (cause, enabled) =>
      toast.add({
        type: "error",
        title: `Couldn't turn Tailscale ${enabled ? "on" : "off"}: ${errorMessage(cause)}`,
        id: "remote-access",
      }),
    onSettled: () => client.invalidateQueries({ queryKey: keys.remoteAccess }),
  });

  const signOut = useMutation({
    mutationFn: () => nyte.host.remote.signOutTailnet(),
    onError: (cause) =>
      toast.add({
        type: "error",
        title: `Couldn't sign out of Tailscale: ${errorMessage(cause)}`,
        id: "remote-access",
      }),
    onSettled: () => client.invalidateQueries({ queryKey: keys.remoteAccess }),
  });

  const state = remote.data;
  const serving = state?.kind === "serving" ? state : undefined;
  const accountShared = account?.kind === "linked" && account.enabled;
  const tailnetShared = state?.tailnet.state === "running";

  const stopSharing = useMutation({
    mutationFn: async () => {
      await Promise.all([
        serving === undefined ? undefined : nyte.host.remote.stop(),
        tailnetShared ? nyte.host.remote.configureTailnet({ enabled: false }) : undefined,
        accountShared ? nyte.host.connect.setEnabled({ enabled: false }) : undefined,
      ]);
    },
    onSuccess: () => setConfirming(false),
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: keys.remoteAccess }),
        client.invalidateQueries({ queryKey: keys.connect }),
      ]),
  });

  const pending =
    start.isPending ||
    stop.isPending ||
    stopSharing.isPending ||
    tailnet.isPending ||
    signOut.isPending;

  const reaches = [
    tailnetShared ? "Tailscale" : undefined,
    serving === undefined ? undefined : "Cloudflare Tunnel",
    accountShared ? "your Nyte account" : undefined,
  ].filter((reach) => reach !== undefined);

  const serve = (reach: RemoteReach) => (on: boolean) => {
    if (on) start.mutate(reach);
    else stop.mutate();
  };

  const servingOver = (reach: RemoteReach): boolean => {
    if (start.isPending && start.variables === reach) return true;

    return !stop.isPending && serving?.reach === reach;
  };

  return (
    <>
      <SettingsSection>
        <FactRow
          icon="laptop"
          tone={reaches.length > 0 ? "on" : "neutral"}
          title="This Mac"
          detail={
            state === undefined
              ? remote.isError
                ? errorMessage(remote.error)
                : "Checking…"
              : reaches.length > 0
                ? sharedDetail(reaches, state)
                : "Not shared"
          }
        >
          {reaches.length > 0 && (
            <Button variant="outline" tone="danger" onClick={() => setConfirming(true)}>
              Stop Sharing…
            </Button>
          )}
        </FactRow>
      </SettingsSection>
      {serving !== undefined && <AddressSection state={serving} />}
      {state !== undefined && (
        <>
          <TailscaleSection
            node={state.tailnet}
            pending={pending}
            onEnabled={(enabled) => tailnet.mutate(enabled)}
            onSignOut={() => signOut.mutate()}
          />
          <CloudflareSection
            tunnel={state.cloudflare}
            serving={servingOver("cloudflare")}
            pending={pending}
            onServe={serve("cloudflare")}
          />
        </>
      )}
      <NyteConnection connect={nyte.host.connect} />
      <ConfirmDialog
        open={confirming && reaches.length > 0}
        pending={stopSharing.isPending}
        error={
          stopSharing.error === null
            ? undefined
            : `Couldn't stop sharing this Mac: ${errorMessage(stopSharing.error)}`
        }
        title="Stop sharing this Mac?"
        description={`Devices connected over ${reaches.join(" and ")} are disconnected. Chats already running keep going.`}
        confirmLabel="Stop Sharing"
        pendingLabel="Stopping…"
        onOpenChange={(open) => {
          setConfirming(open);
          stopSharing.reset();
        }}
        onConfirm={() => stopSharing.mutate()}
      />
    </>
  );
}

const subscribeToWindowFocus = (notify: () => void): (() => void) => focusManager.subscribe(notify);

const readWindowFocus = (): boolean => focusManager.isFocused();

export function useWindowFocused(): boolean {
  return useSyncExternalStore(subscribeToWindowFocus, readWindowFocus, readWindowFocus);
}
