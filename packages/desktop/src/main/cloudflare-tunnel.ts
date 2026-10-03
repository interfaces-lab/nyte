/**
 * The built-in Cloudflare remote-access plugin. The user brings a Cloudflare
 * account, a domain on it, and a remotely-managed named tunnel whose public
 * hostname routes to `http://127.0.0.1:<port>`; Nyte brings the listener on
 * that port and runs `cloudflared` only while it serves.
 *
 * Cloudflare terminates TLS, so it reads every request, device tokens
 * included, and so can anyone with access to the tunnel's live logs in the
 * user's Cloudflare account. Every device still authenticates to the listener
 * itself with its own bearer token. A token is minted when the user adds a
 * device, returned once, and stored only as a digest. An unused token expires;
 * the first request that presents it claims it.
 */
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { randomToken } from "@nyte-ai/serve";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { AuthDecision } from "@nyte-ai/server";
import type {
  CloudflareTunnelSettings,
  CloudflareTunnelView,
  RemoteDevice,
  RemotePairing,
} from "@nyte-ai/app/bridge.ts";
import { CloudflaredConnector, findCloudflared, prepareConnectorDirectory } from "./cloudflared.ts";
import type { ConnectorTiming } from "./cloudflared.ts";
import {
  CloudflareTunnelStore,
  DEVICE_LIMIT,
  DEVICE_NAME_LIMIT,
  TunnelStoreFailed,
} from "./cloudflare-tunnel-store.ts";
import type { StoredDevice, TunnelFile } from "./cloudflare-tunnel-store.ts";
import { ExpectedHostError } from "./errors.ts";
import type { RemoteAccessPlugin, RemoteExposure } from "./remote-access-plugin.ts";

/** Devices waiting for their first request at once. */
const PENDING_LIMIT = 5;

const PAIRING_WINDOW_MS = 10 * 60 * 1_000;

const HOSTNAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/u;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

const TunnelToken = Type.Object({
  a: Type.String({ minLength: 1 }),
  s: Type.String(),
  t: Type.String(),
});

function storeFailed(): ExpectedHostError {
  return new ExpectedHostError({
    code: "internal",
    message:
      "Nyte can't read or write ~/.nyte/cloudflare-tunnel.json. Fix or remove it, then restart Nyte.",
  });
}

export interface CloudflareTunnelOptions {
  /** Holds the settings file and cloudflared's private home. */
  readonly home: string;
  /** The cloudflared executable. Absent, the usual install paths are searched. */
  readonly cloudflared?: string;
  readonly pairingWindowMs?: number;
  readonly timing?: ConnectorTiming;
}

type DeviceClaim = "claimed" | "paired" | "refused";

interface Exposed {
  readonly exposure: RemoteExposure;
  readonly connector: CloudflaredConnector;
  readonly hostname: string;
  /** Tells the host something Settings shows has changed; carries nothing itself. */
  readonly changed: () => void;
}

function digest(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

/** `Authorization: Bearer <token>`, read the way `@nyte-ai/server` reads its own token. */
function bearer(request: Request): string | undefined {
  const header = request.headers.get("authorization");

  if (header === null) return undefined;
  const space = header.indexOf(" ");

  if (space === -1 || header.slice(0, space).toLowerCase() !== "bearer") return undefined;

  return header.slice(space + 1).trim();
}

/** Padded standard base64 that re-encodes to itself, as Go's `StdEncoding` reads it. */
function standardBase64(text: string): Buffer | undefined {
  if (text === "" || text.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(text))
    return undefined;
  const bytes = Buffer.from(text, "base64");

  return bytes.toString("base64") === text ? bytes : undefined;
}

/**
 * What a dashboard token decodes to: standard base64 of JSON naming the
 * account, the tunnel's UUID, and its secret as base64 bytes. cloudflared
 * 2026.8.3 refuses anything else (`ParseToken`), so it is checked before
 * saving rather than discovered as a connector that never starts.
 */
function isTunnelToken(token: string): boolean {
  const decoded = standardBase64(token);

  if (decoded === undefined) return false;

  try {
    const value: unknown = JSON.parse(decoded.toString("utf8"));

    return (
      Value.Check(TunnelToken, value) && standardBase64(value.s) !== undefined && UUID.test(value.t)
    );
  } catch {
    return false;
  }
}

function invalid(message: string): ExpectedHostError {
  return new ExpectedHostError({ code: "invalid_input", message, issues: [] });
}

function isLive(device: StoredDevice, now: number): boolean {
  return device.state.kind === "paired" || device.state.expiresAt > now;
}

function deviceView(device: StoredDevice): RemoteDevice {
  return { id: device.id, name: device.name, createdAt: device.createdAt, state: device.state };
}

export class CloudflareTunnelPlugin implements RemoteAccessPlugin<
  CloudflareTunnelSettings,
  CloudflareTunnelView
> {
  private readonly options: CloudflareTunnelOptions;
  private readonly store: CloudflareTunnelStore;
  private exposed: Exposed | undefined;

  constructor(options: CloudflareTunnelOptions) {
    this.options = options;
    this.store = new CloudflareTunnelStore(join(options.home, "cloudflare-tunnel.json"));
  }

  async view(): Promise<CloudflareTunnelView> {
    const loaded = await this.store.read();

    if (loaded.kind === "failed") return { kind: "unavailable" };
    const cloudflaredInstalled = (await this.executable()) !== undefined;

    if (loaded.file === undefined) return { kind: "unconfigured", cloudflaredInstalled };
    const now = Date.now();

    return {
      kind: "configured",
      hostname: loaded.file.hostname,
      port: loaded.file.port,
      cloudflaredInstalled,
      connection: this.exposed?.connector.status() ?? { kind: "stopped" },
      devices: loaded.file.devices.filter((device) => isLive(device, now)).map(deviceView),
    };
  }

  async configure(settings: CloudflareTunnelSettings): Promise<void> {
    this.refuseWhileExposed();
    const hostname = settings.hostname.trim().toLowerCase();
    const tunnelToken = settings.tunnelToken.trim();

    if (!HOSTNAME.test(hostname))
      throw invalid("Enter the public hostname alone, such as nyte.example.com.");

    if (!Number.isInteger(settings.port) || settings.port < 1024 || settings.port > 65_535)
      throw invalid("Choose a port from 1024 to 65535.");

    if (!isTunnelToken(tunnelToken))
      throw invalid(
        "That isn't a tunnel token. Copy it again from the tunnel's page in Cloudflare.",
      );

    await this.change((file) => ({
      file: {
        hostname,
        port: settings.port,
        tunnelToken,
        // Devices saved the old hostname, so none of them could reach the new one.
        devices: file?.hostname === hostname ? file.devices : [],
      },
      result: undefined,
    }));
  }

  async clear(): Promise<void> {
    this.refuseWhileExposed();
    await this.change(() => ({ file: undefined, result: undefined }));
  }

  async pair(input: { readonly name: string }): Promise<RemotePairing> {
    const exposed = this.exposed;

    if (exposed === undefined) {
      throw new ExpectedHostError({
        code: "forbidden",
        message: "Start remote access over Cloudflare before adding a device.",
      });
    }

    // A code shown while the tunnel is down could not be used, and would still be a live credential.
    if (exposed.connector.status().kind !== "connected") {
      throw new ExpectedHostError({
        code: "forbidden",
        message: "Wait until the tunnel is connected, then add the device.",
      });
    }

    const name = input.name.trim();

    if (name === "" || name.length > DEVICE_NAME_LIMIT)
      throw invalid(`Name the device in 1 to ${String(DEVICE_NAME_LIMIT)} characters.`);
    const token = randomToken();
    const now = Date.now();
    const expiresAt = now + (this.options.pairingWindowMs ?? PAIRING_WINDOW_MS);

    const device: StoredDevice = {
      id: randomUUID(),
      name,
      digest: digest(token).toString("base64url"),
      createdAt: now,
      state: { kind: "pending", expiresAt },
    };

    const added = await this.change((file) => {
      if (file === undefined || file.hostname !== exposed.hostname) return { file, result: false };
      const live = file.devices.filter((entry) => isLive(entry, now));

      if (
        live.length >= DEVICE_LIMIT ||
        live.filter((entry) => entry.state.kind === "pending").length >= PENDING_LIMIT
      ) {
        return { file, result: false };
      }

      return { file: { ...file, devices: [...live, device] }, result: true };
    });

    if (!added) {
      throw new ExpectedHostError({
        code: "forbidden",
        message: `Remove a device first. Up to ${String(DEVICE_LIMIT)} devices can be paired, and ${String(PENDING_LIMIT)} can wait to connect.`,
      });
    }

    return { deviceId: device.id, address: exposed.exposure.address, token, expiresAt };
  }

  async revoke(input: { readonly deviceId: string }): Promise<void> {
    await this.change((file) => {
      if (file === undefined || !file.devices.some((device) => device.id === input.deviceId))
        return { file, result: undefined };

      return {
        file: { ...file, devices: file.devices.filter((device) => device.id !== input.deviceId) },
        result: undefined,
      };
    });
  }

  async expose(changed: () => void): Promise<RemoteExposure> {
    this.refuseWhileExposed();
    const loaded = await this.store.read();

    if (loaded.kind === "failed") throw storeFailed();

    if (loaded.file === undefined) {
      throw new ExpectedHostError({
        code: "not_found",
        message: "Set up the Cloudflare tunnel first.",
      });
    }

    const executable = await this.executable();

    if (executable === undefined) {
      throw new ExpectedHostError({
        code: "not_found",
        message: "cloudflared isn't installed on this Mac. Install it, then try again.",
      });
    }

    const { hostname, port, tunnelToken } = loaded.file;
    const directory = join(this.options.home, "cloudflared");
    await prepareConnectorDirectory(directory);
    // Nothing awaits between this check and claiming the exposure below.
    this.refuseWhileExposed();

    const connector = new CloudflaredConnector({
      executable,
      tunnelToken,
      hostname,
      port,
      directory,
      onChange: changed,
      timing: this.options.timing,
    });

    const origin = `https://${hostname}`;

    const exposure: RemoteExposure = {
      address: origin,
      listen: {
        port,
        auth: { kind: "custom", authorize: (request) => this.authorize(request) },
        browserOrigins: [origin],
      },
      connect: () => {
        if (this.exposed?.exposure === exposure) connector.start();
      },
      // Exposed until the connector is gone, so nothing reconfigures or pairs during shutdown.
      disconnect: async () => {
        await connector.stop();

        if (this.exposed?.exposure === exposure) this.exposed = undefined;
      },
    };

    this.exposed = { exposure, connector, hostname, changed };

    return exposure;
  }

  /**
   * Missing credential: unauthorized. Anything else that is not a live device
   * token, or any token once the store has failed: forbidden.
   */
  private async authorize(request: Request): Promise<AuthDecision> {
    const presented = bearer(request);

    if (presented === undefined) return { kind: "deny", reason: "unauthorized" };
    const loaded = await this.store.read();

    if (loaded.kind === "failed" || loaded.file === undefined)
      return { kind: "deny", reason: "forbidden" };
    const wanted = digest(presented);
    let match: StoredDevice | undefined;

    // Compare against every digest so the time taken does not say which one matched.
    for (const device of loaded.file.devices) {
      const stored = Buffer.from(device.digest, "base64url");

      if (stored.length === wanted.length && timingSafeEqual(stored, wanted)) match = device;
    }

    if (match === undefined) return { kind: "deny", reason: "forbidden" };

    if (match.state.kind === "paired") return { kind: "allow" };
    const id = match.id;

    // The claim runs after any revoke queued before it, so a revoked token never comes back.
    const claim = await this.store
      .update<DeviceClaim>((file) => {
        const now = Date.now();
        const device = file?.devices.find((entry) => entry.id === id);

        if (file === undefined || device === undefined) return { file, result: "refused" };

        if (device.state.kind === "paired") return { file, result: "paired" };

        if (device.state.expiresAt <= now) return { file, result: "refused" };
        const paired: StoredDevice = { ...device, state: { kind: "paired", pairedAt: now } };

        return {
          file: {
            ...file,
            devices: file.devices.map((entry) => (entry.id === id ? paired : entry)),
          },
          result: "claimed",
        };
      })
      .catch(() => "refused" as const);

    // Settings shows the device as waiting until it hears this.
    if (claim === "claimed") this.exposed?.changed();

    return claim === "refused" ? { kind: "deny", reason: "forbidden" } : { kind: "allow" };
  }

  private executable(): Promise<string | undefined> {
    return this.options.cloudflared === undefined
      ? findCloudflared()
      : Promise.resolve(this.options.cloudflared);
  }

  private refuseWhileExposed(): void {
    if (this.exposed === undefined) return;
    throw new ExpectedHostError({
      code: "forbidden",
      message: "Stop remote access over Cloudflare first.",
    });
  }

  private async change<T>(
    change: (file: TunnelFile | undefined) => {
      readonly file: TunnelFile | undefined;
      readonly result: T;
    },
  ): Promise<T> {
    try {
      return await this.store.update(change);
    } catch (cause) {
      if (cause instanceof TunnelStoreFailed) throw storeFailed();
      throw cause;
    }
  }
}
