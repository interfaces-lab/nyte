import type { ListenOptions } from "@nyte-ai/sdk";
import type {
  CloudflareTunnelSettings,
  CloudflareTunnelView,
  RemotePairing,
} from "@nyte-ai/app/bridge.ts";

export interface RemoteAccessPlugin<Settings, View> {
  view(): Promise<View>;
  configure(settings: Settings): Promise<void>;
  clear(): Promise<void>;
  pair(input: { readonly name: string }): Promise<RemotePairing>;
  revoke(input: { readonly deviceId: string }): Promise<void>;
  expose(changed: () => void): Promise<RemoteExposure>;
}

export interface RemoteExposure {
  readonly address: string;
  readonly listen: {
    readonly port: number;
    readonly auth: ListenOptions["auth"];
    readonly browserOrigins: readonly string[];
    readonly handle?: (request: Request) => Promise<Response | undefined>;
  };
  connect(): void;
  disconnect(): Promise<void>;
}

export interface RemoteAccessPlugins {
  readonly cloudflare: RemoteAccessPlugin<CloudflareTunnelSettings, CloudflareTunnelView>;
}
