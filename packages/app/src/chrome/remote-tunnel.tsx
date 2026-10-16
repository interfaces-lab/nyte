/** Remote access over the user's own Cloudflare tunnel: set it up, start it, and pair devices. */
import { create, props } from "@stylexjs/stylex";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactElement } from "react";
import { toast } from "@nyte-ai/ui/toast";
import { errorMessage } from "../errors.ts";
import type { CloudflareTunnelView, RemotePairing, TunnelConnection } from "../bridge.ts";
import { Icon } from "@nyte-ai/ui/icon";
import { Button } from "@nyte-ai/ui/button";
import { Input } from "@nyte-ai/ui/input";
import { MenuItem, MenuSeparator } from "@nyte-ai/ui/menu";
import { nyte } from "../nyte.ts";
import { keys } from "../queries.ts";
import { ConnectionMenu, ConnectionRow, type ConnectionStanding } from "./connection-list.tsx";
import { modelsSettingsStyles as styles } from "./models-settings.stylex.ts";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { AddDevice, PairingPanel, useRevokeDevice } from "./remote-devices.tsx";
import { DeviceRows } from "./device-rows.tsx";
import { shareStyles } from "./remote-share.tsx";

const tunnelStyles = create({
  port: { flexGrow: 0, flexShrink: 0, width: 96 },
});

const DEFAULT_TUNNEL_PORT = 5182;

type ConfiguredTunnel = Extract<CloudflareTunnelView, { kind: "configured" }>;

export function tunnelStatus(tunnel: CloudflareTunnelView): ConnectionStanding {
  if (tunnel.kind !== "configured") return { tone: "on", status: "Serving" };
  const { connection } = tunnel;

  switch (connection.kind) {
    case "stopped":
      return { tone: "off", status: "Stopped" };
    case "connecting":
      return { tone: "warn", status: "Connecting…" };
    case "connected":
      return { tone: "on", status: "Over Cloudflare" };
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
      return `The tunnel routes more than this hostname to http://127.0.0.1:${String(port)}. Leave it one public hostname with that service, then start again.`;
    case "ingress_unverified":
      return "Cloudflare didn't send the tunnel's routes. Check that it has a public hostname, then start again.";
    case "exited":
      return "cloudflared stopped and didn't come back. Stop remote access, then start it again.";
    default: {
      const _exhaustive: never = connection.reason;

      return _exhaustive;
    }
  }
}

/**
 * The tunnel the user created in Cloudflare. The token lives in this form's
 * own state and goes with it; it is sent once, never through the query cache.
 */
function TunnelForm({
  initial,
  onDone,
}: {
  initial: { readonly hostname: string; readonly port: number } | undefined;
  onDone: () => void;
}): ReactElement {
  const client = useQueryClient();
  const [hostname, setHostname] = useState(initial?.hostname ?? "");
  const [port, setPort] = useState(String(initial?.port ?? DEFAULT_TUNNEL_PORT));
  const [tunnelToken, setTunnelToken] = useState("");
  const [pending, setPending] = useState(false);
  const portNumber = Number(port);
  const ready = hostname.trim() !== "" && Number.isInteger(portNumber) && tunnelToken.trim() !== "";

  const save = async (): Promise<void> => {
    setPending(true);

    const outcome = await nyte.host.remote
      .configure({
        plugin: "cloudflare",
        hostname: hostname.trim(),
        port: portNumber,
        tunnelToken: tunnelToken.trim(),
      })
      .then(
        () => ({ kind: "saved" as const }),
        (cause: unknown) => ({ kind: "failed" as const, cause }),
      );

    setPending(false);
    void client.invalidateQueries({ queryKey: keys.remoteAccess });

    if (outcome.kind === "failed") {
      toast.add({
        type: "error",
        title: `Couldn't save the tunnel: ${errorMessage(outcome.cause)}`,
        id: "cloudflare-tunnel",
      });

      return;
    }

    setTunnelToken("");
    onDone();
  };

  return (
    <form
      {...props(styles.keyForm)}
      onSubmit={(event) => {
        event.preventDefault();

        if (!pending && ready) void save();
      }}
    >
      <div {...props(styles.keyRow)}>
        <Input
          variant="code"
          aria-label="Public hostname"
          autoComplete="off"
          spellCheck={false}
          placeholder="nyte.example.com"
          value={hostname}
          disabled={pending}
          xstyle={styles.keyInput}
          onValueChange={setHostname}
        />
        <Input
          variant="code"
          aria-label="Local port"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          value={port}
          disabled={pending}
          xstyle={[styles.keyInput, tunnelStyles.port]}
          onValueChange={setPort}
        />
      </div>
      <div {...props(styles.keyRow)}>
        <Input
          variant="code"
          type="password"
          aria-label="Tunnel token"
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste the tunnel's token from Cloudflare"
          value={tunnelToken}
          disabled={pending}
          xstyle={styles.keyInput}
          onValueChange={setTunnelToken}
        />
        <Button type="submit" variant="solid" tone="primary" loading={pending} disabled={!ready}>
          Save Tunnel
        </Button>
        <Button variant="outline" disabled={pending} onClick={onDone}>
          Cancel
        </Button>
      </div>
      <span {...props(text.sm, styles.keyHint)}>
        {`In Cloudflare, give the tunnel one public hostname with the service http://127.0.0.1:${Number.isInteger(portNumber) ? String(portNumber) : "<port>"}, and no private network routes. The token is stored on this Mac in ~/.nyte.`}
      </span>
    </form>
  );
}

/** A tunnel's paired devices; Remove acts at once. */
function TunnelDevices({
  tunnel,
  revoke,
}: {
  readonly tunnel: ConfiguredTunnel;
  readonly revoke: ReturnType<typeof useRevokeDevice>;
}): ReactElement | null {
  return (
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
  );
}

/** A code on screen, and whether the device list has shown its device yet. */
interface ShownPairing {
  readonly pairing: RemotePairing;
  readonly name: string;
  readonly listed: boolean;
}

/**
 * The tunnel while it serves: its devices, and a way to add one once it is
 * connected. The list may not have caught up with a code just made, so its
 * absence counts only after the device has appeared; claimed or gone, the
 * token is dropped.
 */
export function TunnelServingPanel({ tunnel }: { tunnel: ConfiguredTunnel }): ReactElement {
  const client = useQueryClient();
  const revoke = useRevokeDevice();
  const [shown, setShown] = useState<ShownPairing | undefined>(undefined);
  const failure = tunnelFailure(tunnel.connection, tunnel.port);

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
    <div {...props(shareStyles.panel)}>
      {failure !== undefined && <span {...props(text.sm, styles.alert)}>{failure}</span>}
      {shown !== undefined ? (
        <PairingPanel
          key={shown.pairing.deviceId}
          pairing={shown.pairing}
          name={shown.name}
          onDone={() => setShown(undefined)}
          onExpired={() => {
            setShown(undefined);
            void client.invalidateQueries({ queryKey: keys.remoteAccess });
          }}
        />
      ) : tunnel.connection.kind === "connected" ? (
        <AddDevice onPaired={(pairing, name) => setShown({ pairing, name, listed: false })} />
      ) : tunnel.connection.kind === "failed" ? null : (
        <span {...props(text.sm, styles.deviceCodeNote)}>
          Devices can be added once the tunnel connects.
        </span>
      )}
      {tunnel.devices.length === 0 ? (
        <span {...props(text.sm, styles.deviceCodeNote)}>No devices yet.</span>
      ) : (
        <TunnelDevices tunnel={tunnel} revoke={revoke} />
      )}
    </div>
  );
}

/** The tunnel while remote access is off: set it up, change it, start it, or remove devices. */
export function TunnelRow({
  tunnel,
  starting,
  disabled,
  onStart,
}: {
  tunnel: CloudflareTunnelView;
  starting: boolean;
  disabled: boolean;
  onStart: () => void;
}): ReactElement | null {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const revoke = useRevokeDevice();

  const clear = useMutation({
    mutationFn: () => nyte.host.remote.clear({ plugin: "cloudflare" }),
    onError: (cause) =>
      toast.add({
        type: "error",
        title: `Couldn't remove the tunnel: ${errorMessage(cause)}`,
        id: "cloudflare-tunnel",
      }),
    onSettled: () => client.invalidateQueries({ queryKey: keys.remoteAccess }),
  });

  const glyph = <Icon name="cloudflare" size={16} />;
  const title = "Over Cloudflare Tunnel";

  switch (tunnel.kind) {
    case "unregistered":
      return null;
    case "unavailable":
      return (
        <ConnectionRow
          glyph={glyph}
          title={title}
          detail="Nyte can't read or write ~/.nyte/cloudflare-tunnel.json. Fix or remove it, then restart Nyte."
        />
      );
    case "unconfigured":
      return (
        <ConnectionRow
          glyph={glyph}
          title={title}
          detail={
            tunnel.cloudflaredInstalled
              ? "Your own named tunnel and domain."
              : "Needs cloudflared on this Mac, and your own named tunnel and domain."
          }
          control={
            editing ? undefined : (
              <Button variant="outline" disabled={disabled} onClick={() => setEditing(true)}>
                Set Up Tunnel
              </Button>
            )
          }
          expansion={
            editing ? (
              <TunnelForm initial={undefined} onDone={() => setEditing(false)} />
            ) : undefined
          }
        />
      );
    case "configured":
      return (
        <ConnectionRow
          glyph={glyph}
          title={title}
          detail={
            tunnel.cloudflaredInstalled
              ? `https://${tunnel.hostname}`
              : "cloudflared isn't installed on this Mac. Install it, then try again."
          }
          control={
            <ConnectionMenu
              label="Cloudflare tunnel"
              tone={tunnel.cloudflaredInstalled ? "off" : "err"}
              status={tunnel.cloudflaredInstalled ? "Ready" : "Needs cloudflared"}
              loading={starting || clear.isPending}
              disabled={disabled}
            >
              <MenuItem disabled={!tunnel.cloudflaredInstalled} onClick={onStart}>
                Start Remote Access
              </MenuItem>
              <MenuItem onClick={() => setEditing(true)}>Change Tunnel…</MenuItem>
              <MenuSeparator />
              <MenuItem variant="danger" onClick={() => clear.mutate()}>
                Remove Tunnel and Devices
              </MenuItem>
            </ConnectionMenu>
          }
          expansion={
            editing ? (
              <TunnelForm
                initial={{ hostname: tunnel.hostname, port: tunnel.port }}
                onDone={() => setEditing(false)}
              />
            ) : tunnel.devices.length > 0 ? (
              <TunnelDevices tunnel={tunnel} revoke={revoke} />
            ) : undefined
          }
        />
      );
    default: {
      const _exhaustive: never = tunnel;

      return _exhaustive;
    }
  }
}
