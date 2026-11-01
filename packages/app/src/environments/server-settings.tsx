import { focusManager, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import { Button } from "@nyte-ai/ui/button";
import { Toggle } from "@nyte-ai/ui/toggle";
import { toast } from "@nyte-ai/ui/toast";
import { errorMessage } from "../contract/errors.ts";
import type { RemoteAccessState, RemoteReach } from "../contract/bridge.ts";
import { nyte } from "../contract/nyte.ts";
import { keys } from "../data/query-client.ts";
import { useRemoteAccessState } from "../data/host.ts";
import { SettingsDialog, SettingsDialogCard } from "../settings/dialog.tsx";
import { SettingsRow, SettingsSection, SettingsSwitchRow } from "../settings/rows.tsx";
import { props } from "@stylexjs/stylex";
import { useConnectView } from "../account/connect-view.ts";
import { FactRow } from "../components/connection-list.tsx";
import { NyteConnection } from "./nyte-connection.tsx";
import { PairingCode, pairingPayload } from "./pairing-code.tsx";
import { CopyButton, ValueRow, shareStyles } from "./remote-share.tsx";
import { CloudflareSection, TunnelPairButton } from "./remote-tunnel.tsx";

type Serving = Extract<RemoteAccessState, { kind: "serving" }>;

type TokenServing = Extract<Serving, { reach: "tailnet" }>;

const HIDDEN = "••••••••••••••••";

function TokenPairButton({ state }: { readonly state: TokenServing }): ReactElement {
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);

  return (
    <>
      <Button variant="solid" tone="primary" onClick={() => setOpen(true)}>
        Pair…
      </Button>
      <SettingsDialog
        open={open}
        title="Pair a Device"
        description="In the Nyte iOS app, tap Connect with Tailscale, then Scan QR code. The code carries the token, so treat it like a password."
        onOpenChange={(next) => {
          setOpen(next);
          setRevealed(false);
        }}
      >
        <div {...props(shareStyles.pair)}>
          <PairingCode
            value={pairingPayload({ address: state.address, token: state.token })}
            size={160}
          />
        </div>
        <SettingsDialogCard>
          <ValueRow title="Address" value={state.address}>
            <CopyButton label="Address" value={state.address} />
          </ValueRow>
          <ValueRow title="Token" value={revealed ? state.token : HIDDEN}>
            <Toggle
              iconOnly
              icon="eye"
              aria-label={revealed ? "Hide token" : "Reveal token"}
              pressed={revealed}
              onPressedChange={setRevealed}
            />
            <CopyButton label="Token" value={state.token} />
          </ValueRow>
          <ValueRow
            title="Pairing link"
            value={revealed ? state.pairingUrl : state.pairingUrl.replace(state.token, HIDDEN)}
          >
            <CopyButton label="Pairing link" value={state.pairingUrl} />
          </ValueRow>
        </SettingsDialogCard>
      </SettingsDialog>
    </>
  );
}

function AddressSection({ state }: { readonly state: Serving }): ReactElement {
  return (
    <SettingsSection>
      <SettingsRow title="Remote address" description={state.address} controlWidth="wide">
        <span {...props(shareStyles.actions)}>
          <CopyButton label="Address" value={state.address} />
          {state.reach === "tailnet" ? (
            <TokenPairButton state={state} />
          ) : state.cloudflare.kind === "configured" ? (
            <TunnelPairButton tunnel={state.cloudflare} />
          ) : null}
        </span>
      </SettingsRow>
    </SettingsSection>
  );
}

function tailscaleDetail(state: RemoteAccessState): string | undefined {
  if (state.kind === "serving")
    return state.reach === "tailnet" ? "Running on this Mac" : undefined;

  switch (state.tailnet.kind) {
    case "missing":
      return "Not installed on this Mac";
    case "unavailable":
      return "Not running. Start Tailscale, then turn this on.";
    case "ready":
      return `Running on this Mac as ${state.tailnet.name ?? state.tailnet.ip}`;
    default: {
      const _exhaustive: never = state.tailnet;

      return _exhaustive;
    }
  }
}

function TailscaleSection({
  state,
  serving,
  pending,
  onServe,
}: {
  readonly state: RemoteAccessState;
  readonly serving: boolean;
  readonly pending: boolean;
  readonly onServe: (on: boolean) => void;
}): ReactElement {
  const detail = tailscaleDetail(state);
  const blocked = state.kind === "serving" && state.reach !== "tailnet";

  return (
    <SettingsSection
      title="Tailscale"
      note="Each time you turn it on, Nyte makes a new token. The pairing code carries it, so treat it like a password."
    >
      {detail !== undefined && (
        <FactRow
          icon="devices"
          tone={serving ? "on" : "neutral"}
          title="Tailscale app"
          detail={detail}
        />
      )}
      <SettingsSwitchRow
        title="Serve over Tailscale"
        description={
          blocked
            ? "Turn off Serve over Cloudflare Tunnel first. This Mac serves over one of them at a time."
            : "Uses Tailscale Serve on this Mac's own address"
        }
        checked={serving}
        disabled={pending || blocked || (state.kind === "off" && state.tailnet.kind !== "ready")}
        onCheckedChange={onServe}
      />
    </SettingsSection>
  );
}

function reachLabel(reach: RemoteReach): string {
  return reach === "tailnet" ? "Tailscale" : "Cloudflare Tunnel";
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
    onError: (cause, reach) =>
      toast.add({
        type: "error",
        title: `Couldn't serve over ${reachLabel(reach)}: ${errorMessage(cause)}`,
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

  const state = remote.data;
  const serving = state?.kind === "serving" ? state : undefined;
  const accountShared = account?.kind === "linked" && account.enabled;

  const stopSharing = useMutation({
    mutationFn: async () => {
      await Promise.all([
        serving === undefined ? undefined : nyte.host.remote.stop(),
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

  const pending = start.isPending || stop.isPending || stopSharing.isPending;

  const reaches = [
    serving === undefined ? undefined : reachLabel(serving.reach),
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
            state={state}
            serving={servingOver("tailnet")}
            pending={pending}
            onServe={serve("tailnet")}
          />
          <CloudflareSection
            tunnel={state.cloudflare}
            serving={servingOver("cloudflare")}
            blocked={serving !== undefined && serving.reach !== "cloudflare"}
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
