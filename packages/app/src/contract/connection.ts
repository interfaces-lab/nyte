import type { ConnectOptions, CredentialSource } from "@nyte-ai/sdk";

export interface HostEndpoint {
  readonly url: string;
  /** This client's build, which the host compares with its own in each hello. A web app, which ships no version, sends `web`, and the operations digest decides. */
  readonly version: string;
  readonly credentials: CredentialSource;
  readonly expect?: ConnectOptions["expect"];
  readonly mediaOrigin?: string;
}

export interface ConnectionProblem {
  readonly kind: "authentication" | "network" | "incompatible" | "server";
  readonly message: string;
}
