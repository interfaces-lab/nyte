import { props } from "@stylexjs/stylex";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactElement } from "react";
import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import { Button } from "@nyte-ai/ui/button";
import { Input } from "@nyte-ai/ui/input";
import { intent } from "@nyte-ai/ui/surface-theme";
import { errorMessage } from "../contract/errors.ts";
import type {
  CloudflareTunnelSettings,
  CloudflareTunnelView,
  RemotePairing,
  TunnelConnection,
} from "../contract/bridge.ts";
import { nyte } from "../contract/nyte.ts";
import { keys } from "../data/query-client.ts";
import { SettingsField, SettingsFormDialog } from "../settings/dialog.tsx";
import { SettingsSection, SettingsSwitchRow } from "../settings/rows.tsx";
import {
  ConnectionStatus,
  FactRow,
  type ConnectionStanding,
} from "../components/connection-list.tsx";
import { DeviceRows } from "./device-rows.tsx";
import { NameDeviceDialog, PairingDialog, useRevokeDevice } from "./remote-devices.tsx";

const DEFAULT_TUNNEL_PORT = 5182;

const TITLE = "Cloudflare Tunnel";

type ConfiguredTunnel = Extract<CloudflareTunnelView, { kind: "configured" }>;

export function tunnelStatus(connection: TunnelConnection): ConnectionStanding {
  switch (connection.kind) {
    case "stopped":
      return { tone: "off", status: "Stopped" };
    case "connecting":
      return { tone: "warn", status: "Connecting…" };
    case "connected":
      return { tone: "on", status: "Connected" };
    case "retrying":
      return { tone: "warn", status: "Reconnecting…" };
    case "failed":
      return { tone: "err", status: "Not reachable" };
    default: {
      const _exhaustive: never = connection;

      return _exhaustive;
    }
  }
}

function tunnelFailure(connection: TunnelConnection, port: number): string | undefined {
  if (connection.kind !== "failed") return undefined;

  switch (connection.reason) {
    case "ingress_mismatch":
      return `The tunnel routes more than this hostname to http://127.0.0.1:${String(port)}. Leave it one public hostname with that service, then turn serving on again.`;
    case "ingress_unverified":
      return "Cloudflare didn't send the tunnel's routes. Check that it has a public hostname, then turn serving on again.";
    case "exited":
      return "cloudflared stopped and didn't come back. Turn serving off, then on again.";
    default: {
      const _exhaustive: never = connection.reason;

      return _exhaustive;
    }
  }
}

function portProblem(port: string): string | undefined {
  const value = Number(port);

  if (port.trim() !== "" && Number.isInteger(value) && value >= 1 && value <= 65_535)
    return undefined;

  return "Ports are whole numbers from 1 to 65535.";
}

function TunnelDialog({
  initial,
  onOpenChange,
}: {
  readonly initial: { readonly hostname: string; readonly port: number } | undefined;
  readonly onOpenChange: (open: boolean) => void;
}): ReactElement {
  const client = useQueryClient();
  const [hostname, setHostname] = useState(initial?.hostname ?? "");
  const [port, setPort] = useState(String(initial?.port ?? DEFAULT_TUNNEL_PORT));
  const [tunnelToken, setTunnelToken] = useState("");
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const badPort = portProblem(port);

  const save = async (settings: CloudflareTunnelSettings): Promise<void> => {
    setPending(true);
    setFailure(undefined);

    const outcome = await nyte.host.remote.configure({ plugin: "cloudflare", ...settings }).then(
      () => undefined,
      (cause: unknown) => `Couldn't save the tunnel: ${errorMessage(cause)}`,
    );

    setPending(false);
    void client.invalidateQueries({ queryKey: keys.remoteAccess });

    if (outcome !== undefined) {
      setFailure(outcome);

      return;
    }

    onOpenChange(false);
  };

  return (
    <SettingsFormDialog
      open
      title={initial === undefined ? "Set Up Cloudflare Tunnel" : "Change Cloudflare Tunnel"}
      description={`In Cloudflare, give the tunnel one public hostname with the service http://127.0.0.1:${badPort === undefined ? port.trim() : "<port>"}, and no private network routes.`}
      submitLabel="Save Tunnel"
      canSubmit={hostname.trim() !== "" && badPort === undefined && tunnelToken.trim() !== ""}
      pending={pending}
      error={failure}
      onOpenChange={onOpenChange}
      onSubmit={() =>
        void save({
          hostname: hostname.trim(),
          port: Number(port),
          tunnelToken: tunnelToken.trim(),
        })
      }
    >
      <SettingsField label="Public hostname">
        <Input
          variant="code"
          aria-label="Public hostname"
          autoComplete="off"
          spellCheck={false}
          placeholder="nyte.example.com"
          value={hostname}
          onValueChange={setHostname}
        />
      </SettingsField>
      <SettingsField label="Local port" error={badPort}>
        <Input
          variant="code"
          aria-label="Local port"
          aria-invalid={badPort !== undefined}
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          value={port}
          onValueChange={setPort}
        />
      </SettingsField>
      <SettingsField label="Tunnel token" hint="Stored on this Mac in ~/.nyte.">
        <Input
          variant="code"
          type="password"
          aria-label="Tunnel token"
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste the tunnel's token from Cloudflare"
          value={tunnelToken}
          onValueChange={setTunnelToken}
        />
      </SettingsField>
    </SettingsFormDialog>
  );
}

interface ShownPairing {
  readonly pairing: RemotePairing;
  readonly name: string;
  readonly listed: boolean;
}

/** Pairs one more device over the tunnel, and shows its code until the device claims it. */
export function TunnelPairButton({ tunnel }: { readonly tunnel: ConfiguredTunnel }): ReactElement {
  const client = useQueryClient();
  const [naming, setNaming] = useState(false);
  const [shown, setShown] = useState<ShownPairing | undefined>(undefined);

  const device =
    shown === undefined
      ? undefined
      : tunnel.devices.find((entry) => entry.id === shown.pairing.deviceId);

  if (shown !== undefined) {
    if (device?.state.kind === "paired" || (device === undefined && shown.listed)) {
      setShown(undefined);
    } else if (device !== undefined && !shown.listed) {
      setShown({ ...shown, listed: true });
    }
  }

  return (
    <>
      <Button
        variant="solid"
        tone="primary"
        disabled={tunnel.connection.kind !== "connected"}
        onClick={() => setNaming(true)}
      >
        Pair…
      </Button>
      {naming && (
        <NameDeviceDialog
          onOpenChange={setNaming}
          onPaired={(pairing, name) => {
            setNaming(false);
            setShown({ pairing, name, listed: false });
          }}
        />
      )}
      {shown !== undefined && (
        <PairingDialog
          key={shown.pairing.deviceId}
          pairing={shown.pairing}
          name={shown.name}
          onDone={() => setShown(undefined)}
          onExpired={() => {
            setShown(undefined);
            void client.invalidateQueries({ queryKey: keys.remoteAccess });
          }}
        />
      )}
    </>
  );
}

/** Cloudflare Tunnel: set it up, serve over it, and manage the devices paired through it. */
export function CloudflareSection({
  tunnel,
  serving,
  blocked,
  pending,
  onServe,
}: {
  readonly tunnel: CloudflareTunnelView;
  readonly serving: boolean;
  /** Tailscale serves now; this Mac serves over one of them at a time. */
  readonly blocked: boolean;
  readonly pending: boolean;
  readonly onServe: (on: boolean) => void;
}): ReactElement | null {
  const [editing, setEditing] = useState(false);

  switch (tunnel.kind) {
    case "unregistered":
      return null;
    case "unavailable":
      return (
        <SettingsSection title={TITLE}>
          <FactRow
            icon="cloudflare"
            title="Settings unavailable"
            detail="Nyte can't read or write ~/.nyte/cloudflare-tunnel.json. Fix or remove it, then restart Nyte."
          />
        </SettingsSection>
      );
    case "unconfigured":
      return (
        <SettingsSection title={TITLE}>
          <FactRow
            icon="cloudflare"
            title="Not set up"
            detail={
              tunnel.cloudflaredInstalled
                ? "Uses your own named tunnel and domain."
                : "Needs cloudflared on this Mac, and your own named tunnel and domain."
            }
          >
            <Button variant="outline" onClick={() => setEditing(true)}>
              Set Up Tunnel…
            </Button>
          </FactRow>
          {editing && <TunnelDialog initial={undefined} onOpenChange={setEditing} />}
        </SettingsSection>
      );
    case "configured":
      return (
        <ConfiguredSection
          tunnel={tunnel}
          serving={serving}
          blocked={blocked}
          pending={pending}
          onServe={onServe}
        />
      );
    default: {
      const _exhaustive: never = tunnel;

      return _exhaustive;
    }
  }
}

function ConfiguredSection({
  tunnel,
  serving,
  blocked,
  pending,
  onServe,
}: {
  readonly tunnel: ConfiguredTunnel;
  readonly serving: boolean;
  readonly blocked: boolean;
  readonly pending: boolean;
  readonly onServe: (on: boolean) => void;
}): ReactElement {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const revoke = useRevokeDevice();

  const clear = useMutation({
    mutationFn: () => nyte.host.remote.clear({ plugin: "cloudflare" }),
    onSuccess: () => setRemoving(false),
    onSettled: () => client.invalidateQueries({ queryKey: keys.remoteAccess }),
  });

  const failure = serving ? tunnelFailure(tunnel.connection, tunnel.port) : undefined;
  const standing = tunnelStatus(tunnel.connection);
  const waiting = serving && failure === undefined && tunnel.connection.kind !== "connected";
  const devices = tunnel.devices.length;

  return (
    <SettingsSection
      title={TITLE}
      note={waiting ? "You can pair devices once the tunnel connects." : undefined}
    >
      <FactRow
        icon="cloudflare"
        tone={serving ? "on" : "neutral"}
        title={`https://${tunnel.hostname}`}
        detail={
          !tunnel.cloudflaredInstalled ? (
            "cloudflared isn't installed on this Mac. Install it, then try again."
          ) : failure !== undefined ? (
            <span role="alert" {...props(intent.danger)}>
              {failure}
            </span>
          ) : serving ? (
            <ConnectionStatus tone={standing.tone}>{standing.status}</ConnectionStatus>
          ) : (
            "Not serving"
          )
        }
      >
        <Button variant="outline" onClick={() => setEditing(true)}>
          Change Tunnel…
        </Button>
        <Button variant="outline" onClick={() => setRemoving(true)}>
          Remove Tunnel…
        </Button>
      </FactRow>
      <SettingsSwitchRow
        title="Serve over Cloudflare Tunnel"
        description={
          blocked
            ? "Turn off Serve over Tailscale first. This Mac serves over one of them at a time."
            : "Reach this Mac at its public hostname, from any network"
        }
        checked={serving}
        disabled={pending || blocked || !tunnel.cloudflaredInstalled}
        onCheckedChange={onServe}
      />
      <DeviceRows
        label="Paired devices"
        devices={tunnel.devices.map((device) => ({
          id: device.id,
          name: device.name,
          detail: device.state.kind === "pending" ? "Waiting to connect" : "Paired",
        }))}
        action="Remove"
        pending={revoke.isPending ? revoke.variables : undefined}
        onAction={(deviceId) => revoke.mutate(deviceId)}
      />
      {editing && (
        <TunnelDialog
          initial={{ hostname: tunnel.hostname, port: tunnel.port }}
          onOpenChange={setEditing}
        />
      )}
      <ConfirmDialog
        open={removing}
        pending={clear.isPending}
        error={
          clear.error === null
            ? undefined
            : `Couldn't remove the tunnel: ${errorMessage(clear.error)}`
        }
        title="Remove this tunnel?"
        description={
          devices === 0
            ? `Nyte forgets https://${tunnel.hostname} and its token.`
            : `Nyte forgets https://${tunnel.hostname} and its token, and ${devices === 1 ? "its paired device loses" : `its ${String(devices)} paired devices lose`} access.`
        }
        confirmLabel="Remove Tunnel"
        pendingLabel="Removing…"
        onOpenChange={(open) => {
          setRemoving(open);
          clear.reset();
        }}
        onConfirm={() => clear.mutate()}
      />
    </SettingsSection>
  );
}
