/**
 * Desktop remote-access plugins: how a reach beyond this Mac's loopback is
 * carried. They are built in and registered statically by `index.ts`; nothing
 * is loaded, discovered, or installed at run time.
 *
 * The host owns the share: what is served, workspace trust, and the loopback
 * listener. A plugin owns its settings, the credentials that listener accepts,
 * and the connector that carries outside traffic to it.
 */
import type { ServerAuth } from "@nyte-ai/server";
import type {
  CloudflareTunnelSettings,
  CloudflareTunnelView,
  RemotePairing,
} from "@nyte-ai/app/bridge.ts";

export interface RemoteAccessPlugin<Settings, View> {
  /** Settings and status safe to send to a renderer: no secrets, no connector output. */
  view(): Promise<View>;
  /** Refused while exposed. */
  configure(settings: Settings): Promise<void>;
  /** Refused while exposed. Forgets every device. */
  clear(): Promise<void>;
  /** Only while exposed. The token is in this answer and nowhere else. */
  pair(input: { readonly name: string }): Promise<RemotePairing>;
  /** Once this resolves the device's token is refused. Ending its open streams is the host's job. */
  revoke(input: { readonly deviceId: string }): Promise<void>;
  /**
   * What the host must bind, and the connector to run once it has. Throws an
   * `ExpectedHostError` with a fixed message when the plugin cannot expose.
   */
  expose(changed: () => void): Promise<RemoteExposure>;
}

export interface RemoteExposure {
  /** The public address clients enter. */
  readonly address: string;
  /** The loopback listener the host binds for this exposure. */
  readonly listen: {
    readonly port: number;
    readonly auth: ServerAuth;
    readonly browserOrigins: readonly string[];
    /** Routes this exposure answers itself, before the Nyte server and its auth. */
    readonly handle?: (request: Request) => Promise<Response | undefined>;
  };
  /** Start carrying outside traffic. The host calls it only after the listener is bound. */
  connect(): void;
  /** Stop carrying traffic and end the exposure. Idempotent and time-limited. */
  disconnect(): Promise<void>;
}

/** Every registered plugin, keyed by the reach it serves. */
export interface RemoteAccessPlugins {
  readonly cloudflare: RemoteAccessPlugin<CloudflareTunnelSettings, CloudflareTunnelView>;
}
