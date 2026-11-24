import type { ConnectOptions, CredentialSource } from "@nyte-ai/sdk";

export interface HostEndpoint {
  readonly url: string;
  readonly version: string;
  readonly credentials: CredentialSource;
  readonly expect?: ConnectOptions["expect"];
  readonly mediaOrigin?: string;
}

export interface ConnectionProblem {
  readonly kind: "authentication" | "network" | "incompatible" | "server";
  readonly message: string;
}
