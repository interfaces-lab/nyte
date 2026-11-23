import type { InitializeResponse, McpServer } from "@agentclientprotocol/sdk/unstable";
import type { ProviderToolPort } from "@nyte-ai/ai";
import type { HeadName, SessionId } from "@nyte-ai/schema";

export interface GatewayLease {
  servers(
    peer: InitializeResponse,
    transport: "negotiate" | "stdio-only" | "http-only",
  ): readonly McpServer[];
  close(): Promise<void>;
}

export interface AcpClientServices {
  gateway(input: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly generation: string;
    readonly signal: AbortSignal;
    tools(): ProviderToolPort | undefined;
  }): Promise<GatewayLease>;
}
