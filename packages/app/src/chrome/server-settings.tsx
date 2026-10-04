import { radius } from "@nyte-ai/ui/schema.stylex";
/**
 * The two connections Environments shows, pointing opposite ways. The Cloud
 * row is outbound: a remote Nyte host this desktop reaches, whose chats run
 * with the server's keys. Remote access is inbound: this desktop serving one
 * of its own local stores, with the web app on the same address, to a browser
 * or the iOS app. The Nyte account option comes first; this Mac only,
 * Tailscale, and the user's own Cloudflare tunnel follow as manual setup.
 * Nothing here touches local providers.
 */
import { create, props } from "@stylexjs/stylex";
import { focusManager, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { toast } from "@nyte-ai/ui/toast";
import { errorMessage } from "../errors.ts";
import type {
  CloudflareTunnelView,
  RemoteAccessState,
  RemoteDevice,
  RemotePairing,
  RemoteReach,
  ServedTarget,
  ServerState,
  TailnetAvailability,
  TunnelConnection,
} from "../bridge.ts";
import { Icon } from "@nyte-ai/ui/icon";
import { Button, ButtonLink } from "@nyte-ai/ui/button";
import { Input } from "@nyte-ai/ui/input";
import { srOnly } from "@nyte-ai/ui/a11y.stylex";
import { Tabs } from "@nyte-ai/ui/tabs";
import { MenuItem, MenuSeparator } from "@nyte-ai/ui/menu";
import { nyte } from "../nyte.ts";
import { keys, useRemoteAccessState, useServerState } from "../queries.ts";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import {
  ConnectionList,
  ConnectionMenu,
  ConnectionRow,
  type ConnectionStanding,
} from "./connection-list.tsx";
import { modelsSettingsStyles as styles } from "./models-settings.stylex.ts";
import { NyteConnection } from "./nyte-connection.tsx";
import { PairingCode, pairingPayload } from "./pairing-code.tsx";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import { useMountEffect } from "../use-mount-effect.ts";

const shareStyles = create({
  panel: { display: "flex", flexDirection: "column", gap: 8 },
  step: { display: "flex", flexDirection: "column", gap: 8 },
  switcher: { display: "inline-flex", gap: 8, alignSelf: "flex-start" },
  scan: { display: "flex", alignItems: "center", gap: 12 },
  scanText: { display: "flex", flexDirection: "column", gap: 4, minWidth: 0 },
  // One grid for both fields so the value boxes share a left edge and width.
  fields: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr) auto",
    alignItems: "center",
    columnGap: 8,
    rowGap: 6,
  },
  label: {
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  fieldActions: { display: "inline-flex", gap: 8 },
  // Selected whole so a click cannot grab half of a token or address.
  value: {
    boxSizing: "border-box",
    minWidth: 0,
    paddingInline: 8,
    paddingBlock: 4,
    borderRadius: radius.control,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: role.borderSecondaryTranslucent,
    backgroundColor: role.bgBase,
    color: role.contentPrimary,
    fontFamily: type.fontMono,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
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
      {...props(styles.keyForm)}
      onSubmit={(event) => {
        event.preventDefault();

        if (!pending && ready) onSubmit({ baseUrl: baseUrl.trim(), token: token.trim() });
      }}
    >
      <div {...props(styles.keyRow)}>
        <Input
          variant="quiet"
          type="url"
          aria-label="Server URL"
          autoComplete="off"
          autoFocus
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
          variant="quiet"
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
      <span {...props(styles.keyHint)}>Stored on this Mac in ~/.nyte/server.json.</span>
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

  const { auth } = state.provider;

  return auth.kind === "ready" || auth.kind === "unverified"
    ? { tone: "on", status: "Connected" }
    : { tone: "warn", status: "Model unavailable" };
}

function serverDetail(state: Exclude<ServerState, { kind: "none" }>): string {
  if (state.kind === "unavailable") return state.problem.message;
  const { model, auth } = state.provider;
  const name = `${model.provider}/${model.id}`;

  if (auth.kind !== "ready" && auth.kind !== "unverified") return `${name}: ${auth.message}.`;
  const modelLine = auth.kind === "ready" ? `${name}.` : `${name}, not verified.`;
  const host = state.info.host;

  if (host.kind === "unspecified")
    return `${modelLine} The server responds, but does not report its tools or history storage.`;

  const persistence =
    host.persistence === "durable"
      ? "Chat history uses durable storage."
      : host.persistence === "ephemeral"
        ? "Chat history is temporary and can disappear when the server restarts."
        : "The server has not reported how chat history is stored.";

  return `${modelLine} ${host.capabilities.workspace ? "Workspace tools available." : "Chat only."} ${persistence}`;
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

function CopyButton({ label, value }: { label: string; value: string }): ReactElement {
  const [copied, setCopied] = useState(false);

  return (
    <>
      <Button
        iconOnly
        icon={copied ? "checkmark" : "copy"}
        aria-label={`Copy ${label.toLocaleLowerCase()}`}
        onClick={() => {
          void navigator.clipboard.writeText(value).then(
            () => setCopied(true),
            () => {
              setCopied(false);
              toast.add({
                type: "error",
                title: `Couldn't copy the ${label.toLocaleLowerCase()}. Select it and copy it yourself.`,
              });
            },
          );
        }}
      />
      <span role="status" {...props(srOnly)}>
        {copied ? `${label} copied` : ""}
      </span>
    </>
  );
}

type TokenServing = Extract<RemoteAccessState, { kind: "serving"; reach: "local" | "tailnet" }>;

function servedTargetLabel(target: ServedTarget): string {
  return target.kind === "home" ? "Home" : target.workspace.name;
}

/** The link, address, and token a client needs, with the token hidden until asked for. */
function ServingPanel({ state }: { state: TokenServing }) {
  const [revealed, setRevealed] = useState(false);
  const [step, setStep] = useState<"scan" | "details">("scan");
  const payload = pairingPayload({ address: state.address, token: state.token });

  const hidden = "••••••••••••••••";

  return (
    <Tabs.Root
      variant="segmented"
      value={step}
      onValueChange={(value) => {
        if (value === "scan" || value === "details") setStep(value);
      }}
      {...props(shareStyles.panel)}
    >
      <div {...props(shareStyles.fields)}>
        <span {...props(shareStyles.label)}>Link</span>
        <code aria-label="Pairing link" {...props(shareStyles.value)}>
          {revealed ? state.pairingUrl : state.pairingUrl.replace(state.token, hidden)}
        </code>
        <span {...props(shareStyles.fieldActions)}>
          <CopyButton label="Pairing link" value={state.pairingUrl} />
          <ButtonLink
            href={state.pairingUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => {
              event.preventDefault();
              nyte.host.openExternal({ url: state.pairingUrl }).catch((cause: unknown) => {
                toast.add({
                  type: "error",
                  title: `Couldn't open the link: ${errorMessage(cause)}`,
                });
              });
            }}
          >
            Open Pairing Link
          </ButtonLink>
        </span>
      </div>
      <Tabs.List aria-label="Pairing method" xstyle={shareStyles.switcher}>
        <Tabs.Tab value="scan">Scan</Tabs.Tab>
        <Tabs.Tab value="details">Address and Token</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="scan" xstyle={shareStyles.step}>
        <div {...props(shareStyles.scan)}>
          <PairingCode value={payload} size={132} />
          <span {...props(shareStyles.scanText)}>
            <span {...props(shareStyles.label)}>
              In the iOS app, tap Scan QR code on the connect screen.
            </span>
            <span {...props(styles.deviceCodeNote)}>
              The code carries the token, so treat it like the token itself. It stops working when
              you stop.
            </span>
          </span>
        </div>
      </Tabs.Panel>
      <Tabs.Panel value="details" xstyle={shareStyles.step}>
        <div {...props(shareStyles.fields)}>
          <span {...props(shareStyles.label)}>Address</span>
          <code aria-label="Address" {...props(shareStyles.value)}>
            {state.address}
          </code>
          <span {...props(shareStyles.fieldActions)}>
            <CopyButton label="Address" value={state.address} />
          </span>
          <span {...props(shareStyles.label)}>Token</span>
          <code aria-label="Token" {...props(shareStyles.value)}>
            {revealed ? state.token : hidden}
          </code>
          <span {...props(shareStyles.fieldActions)}>
            <CopyButton label="Token" value={state.token} />
            <Button
              iconOnly
              icon="eye"
              aria-label={revealed ? "Hide token" : "Reveal token"}
              aria-pressed={revealed}
              onClick={() => setRevealed((value) => !value)}
            />
          </span>
        </div>
        <span {...props(styles.deviceCodeNote)}>
          {state.reach === "tailnet"
            ? "Reachable from your signed-in Tailscale devices on any network, and from nothing else. The token is new each time and never written to disk."
            : "Only this Mac can reach this address, so a physical phone can't. The token is new each time and never written to disk."}
        </span>
      </Tabs.Panel>
    </Tabs.Root>
  );
}

function tailnetDetail(tailnet: TailnetAvailability): string {
  if (tailnet.kind === "missing") return "Tailscale isn't installed on this Mac.";

  if (tailnet.kind === "unavailable") return "Tailscale isn't running. Start it, then try again.";

  return `Reachable at ${tailnet.name ?? tailnet.ip} from your signed-in devices, on any network.`;
}

const tunnelStyles = create({
  port: { flexGrow: 0, flexShrink: 0, width: 96 },
  devices: { display: "flex", flexDirection: "column", gap: 4 },
  device: { display: "flex", alignItems: "center", gap: 8 },
  deviceName: {
    flexGrow: 1,
    minWidth: 0,
    color: role.contentPrimary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    overflowWrap: "anywhere",
  },
});

const DEFAULT_TUNNEL_PORT = 5182;

type ConfiguredTunnel = Extract<CloudflareTunnelView, { kind: "configured" }>;

function tunnelStatus(tunnel: CloudflareTunnelView): ConnectionStanding {
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
          variant="quiet"
          aria-label="Public hostname"
          autoComplete="off"
          autoFocus
          spellCheck={false}
          placeholder="nyte.example.com"
          value={hostname}
          disabled={pending}
          xstyle={styles.keyInput}
          onValueChange={setHostname}
        />
        <Input
          variant="quiet"
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
          variant="quiet"
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
      <span {...props(styles.keyHint)}>
        {`In Cloudflare, give the tunnel one public hostname with the service http://127.0.0.1:${Number.isInteger(portNumber) ? String(portNumber) : "<port>"}, and no private network routes. The token is stored on this Mac in ~/.nyte.`}
      </span>
    </form>
  );
}

function DeviceList({
  devices,
  onRevoke,
  revoking,
}: {
  devices: readonly RemoteDevice[];
  onRevoke: (deviceId: string) => void;
  revoking: string | undefined;
}): ReactElement {
  if (devices.length === 0) {
    return <span {...props(styles.deviceCodeNote)}>No devices yet.</span>;
  }

  return (
    <ul aria-label="Paired devices" {...props(tunnelStyles.devices)}>
      {devices.map((device) => (
        <li key={device.id} {...props(tunnelStyles.device)}>
          <span {...props(tunnelStyles.deviceName)}>{device.name}</span>
          <span {...props(styles.deviceCodeNote)}>
            {device.state.kind === "pending" ? "Waiting to connect" : "Paired"}
          </span>
          <Button
            loading={revoking === device.id}
            disabled={revoking !== undefined}
            onClick={() => onRevoke(device.id)}
          >
            Remove
          </Button>
        </li>
      ))}
    </ul>
  );
}

function useRevokeDevice() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (deviceId: string) => nyte.host.remote.revoke({ plugin: "cloudflare", deviceId }),
    onError: (cause) =>
      toast.add({
        type: "error",
        title: `Couldn't remove the device: ${errorMessage(cause)}`,
        id: "cloudflare-device",
      }),
    onSettled: () => client.invalidateQueries({ queryKey: keys.remoteAccess }),
  });
}

/**
 * A new device's code. Its token is that device's lasting credential, held
 * only in the serving panel's state; Done, a claim, a removal, or expiry
 * drops it, and so does leaving the page.
 */
function PairingPanel({
  pairing,
  name,
  onDone,
  onExpired,
}: {
  pairing: RemotePairing;
  name: string;
  onDone: () => void;
  onExpired: () => void;
}): ReactElement {
  const link = `${pairing.address}/pair#host=${encodeURIComponent(pairing.address)}&token=${encodeURIComponent(pairing.token)}`;

  // The host stops listing an unused code once it expires, but says nothing then.
  useMountEffect(() => {
    const timer = setTimeout(onExpired, Math.max(0, pairing.expiresAt - Date.now()));

    return () => clearTimeout(timer);
  });

  return (
    <div {...props(shareStyles.panel)}>
      <div {...props(shareStyles.scan)}>
        <PairingCode
          value={pairingPayload({ address: pairing.address, token: pairing.token })}
          size={132}
        />
        <span {...props(shareStyles.scanText)}>
          <span {...props(shareStyles.label)}>
            In the iOS app, tap Scan QR code on the connect screen.
          </span>
          <span {...props(styles.deviceCodeNote)}>
            {`Anyone with this code can connect as ${name} until you remove it. It expires at ${new Date(pairing.expiresAt).toLocaleTimeString()} if unused.`}
          </span>
        </span>
      </div>
      <div {...props(shareStyles.fields)}>
        <span {...props(shareStyles.label)}>Link</span>
        <code aria-label="Pairing link" {...props(shareStyles.value)}>
          {pairing.address}/pair
        </code>
        <span {...props(shareStyles.fieldActions)}>
          <CopyButton label="Pairing link" value={link} />
        </span>
      </div>
      <Button onClick={onDone}>Done</Button>
    </div>
  );
}

function AddDevice({
  onPaired,
}: {
  onPaired: (pairing: RemotePairing, name: string) => void;
}): ReactElement {
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);

  const add = async (): Promise<void> => {
    const chosen = name.trim();
    setPending(true);

    const outcome = await nyte.host.remote.pair({ plugin: "cloudflare", name: chosen }).then(
      (pairing) => ({ kind: "paired" as const, pairing }),
      (cause: unknown) => ({ kind: "failed" as const, cause }),
    );

    setPending(false);
    void client.invalidateQueries({ queryKey: keys.remoteAccess });

    if (outcome.kind === "failed") {
      toast.add({
        type: "error",
        title: `Couldn't add the device: ${errorMessage(outcome.cause)}`,
        id: "cloudflare-device",
      });

      return;
    }

    setName("");
    onPaired(outcome.pairing, chosen);
  };

  return (
    <form
      {...props(styles.keyRow)}
      onSubmit={(event) => {
        event.preventDefault();

        if (!pending && name.trim() !== "") void add();
      }}
    >
      <Input
        variant="quiet"
        aria-label="Device name"
        autoComplete="off"
        spellCheck={false}
        placeholder="iPhone"
        maxLength={64}
        value={name}
        disabled={pending}
        xstyle={styles.keyInput}
        onValueChange={setName}
      />
      <Button type="submit" loading={pending} disabled={name.trim() === ""}>
        Add Device
      </Button>
    </form>
  );
}

/** A code on screen, and whether the device list has shown its device yet. */
interface ShownPairing {
  readonly pairing: RemotePairing;
  readonly name: string;
  readonly listed: boolean;
}

/** The tunnel while it serves: its devices, and a way to add one once it is connected. */
function TunnelServingPanel({ tunnel }: { tunnel: ConfiguredTunnel }): ReactElement {
  const client = useQueryClient();
  const revoke = useRevokeDevice();
  const [shown, setShown] = useState<ShownPairing | undefined>(undefined);
  const failure = tunnelFailure(tunnel.connection, tunnel.port);

  const device =
    shown === undefined
      ? undefined
      : tunnel.devices.find((entry) => entry.id === shown.pairing.deviceId);

  // The list may not have caught up with a code just made, so its absence
  // counts only after the device has appeared. Claimed or gone: drop the token.
  if (shown !== undefined) {
    if (device?.state.kind === "paired" || (device === undefined && shown.listed)) {
      setShown(undefined);
    } else if (device !== undefined && !shown.listed) {
      setShown({ ...shown, listed: true });
    }
  }

  return (
    <div {...props(shareStyles.panel)}>
      {failure !== undefined && <span {...props(styles.alert)}>{failure}</span>}
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
        <span {...props(styles.deviceCodeNote)}>
          Devices can be added once the tunnel connects.
        </span>
      )}
      <DeviceList
        devices={tunnel.devices}
        revoking={revoke.isPending ? revoke.variables : undefined}
        onRevoke={(deviceId) => revoke.mutate(deviceId)}
      />
    </div>
  );
}

/** The tunnel while remote access is off: set it up, change it, start it, or remove devices. */
function TunnelRow({
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

  const glyph = <Icon name="globe" size={16} />;
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
              <DeviceList
                devices={tunnel.devices}
                revoking={revoke.isPending ? revoke.variables : undefined}
                onRevoke={(deviceId) => revoke.mutate(deviceId)}
              />
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

export function RemoteAccess({ active }: { readonly active: boolean }): ReactElement {
  const client = useQueryClient();
  const remote = useRemoteAccessState(active);

  const start = useMutation({
    mutationFn: (reach: RemoteReach) => nyte.host.remote.start({ reach }),
    onError: (cause) =>
      toast.add({
        type: "error",
        title: `Couldn't start remote access: ${errorMessage(cause)}`,
        id: "remote-access",
      }),
    onSettled: () => client.invalidateQueries({ queryKey: keys.remoteAccess }),
  });

  const stop = useMutation({
    mutationFn: () => nyte.host.remote.stop(),
    onError: (cause) =>
      toast.add({
        type: "error",
        title: `Couldn't stop remote access: ${errorMessage(cause)}`,
        id: "remote-access",
      }),
    onSettled: () => client.invalidateQueries({ queryKey: keys.remoteAccess }),
  });

  const state = remote.data;
  const pending = start.isPending || stop.isPending;

  const stopItem = <MenuItem onClick={() => stop.mutate()}>Stop Remote Access</MenuItem>;

  return (
    <>
      <NyteConnection connect={nyte.host.connect} active={active} />
      <div {...props(settingsPatterns.sectionHeader)}>
        <h2 {...props(settingsPatterns.sectionTitle)}>Manual setup</h2>
      </div>
      <ConnectionList>
        {state === undefined ? null : state.kind === "off" ? (
          <>
            <ConnectionRow
              glyph={<Icon name="computer" size={16} />}
              title="This Mac only"
              detail="Serves the selected folder. Switching folders here afterwards doesn't move it; a connected client can."
              control={
                <Button
                  variant="outline"

                  loading={start.isPending && start.variables === "local"}
                  disabled={pending && start.variables !== "local"}
                  onClick={() => start.mutate("local")}
                >
                  Start
                </Button>
              }
            />
            <ConnectionRow
              glyph={<Icon name="devices" size={16} />}
              title="Over Tailscale"
              detail={tailnetDetail(state.tailnet)}
              control={
                <Button
                  variant="outline"

                  loading={start.isPending && start.variables === "tailnet"}
                  disabled={
                    state.tailnet.kind !== "ready" || (pending && start.variables !== "tailnet")
                  }
                  onClick={() => start.mutate("tailnet")}
                >
                  Start
                </Button>
              }
            />
            <TunnelRow
              tunnel={state.cloudflare}
              starting={start.isPending && start.variables === "cloudflare"}
              disabled={pending && start.variables !== "cloudflare"}
              onStart={() => start.mutate("cloudflare")}
            />
          </>
        ) : state.reach === "cloudflare" ? (
          <ConnectionRow
            glyph={<Icon name="globe" size={16} />}
            title={`Serving ${servedTargetLabel(state.target)}`}
            detail={state.address}
            control={
              <ConnectionMenu
                label="Remote access"
                {...tunnelStatus(state.cloudflare)}
                loading={stop.isPending}
                disabled={start.isPending}
              >
                {stopItem}
              </ConnectionMenu>
            }
            expansion={
              state.cloudflare.kind === "configured" ? (
                <TunnelServingPanel tunnel={state.cloudflare} />
              ) : undefined
            }
          />
        ) : (
          <ConnectionRow
            glyph={<Icon name={state.reach === "tailnet" ? "devices" : "computer"} size={16} />}
            title={`Serving ${servedTargetLabel(state.target)}`}
            detail={state.target.kind === "home" ? undefined : state.target.workspace.path}
            control={
              <ConnectionMenu
                label="Remote access"
                tone="on"
                status={state.reach === "tailnet" ? "Over Tailscale" : "This Mac only"}
                loading={stop.isPending}
                disabled={start.isPending}
              >
                {stopItem}
              </ConnectionMenu>
            }
            expansion={<ServingPanel state={state} />}
          />
        )}
      </ConnectionList>
    </>
  );
}

const subscribeToWindowFocus = (notify: () => void): (() => void) => focusManager.subscribe(notify);

const readWindowFocus = (): boolean => focusManager.isFocused();

/** Connection state is polled only while the window has focus. */
export function useWindowFocused(): boolean {
  return useSyncExternalStore(subscribeToWindowFocus, readWindowFocus, readWindowFocus);
}
