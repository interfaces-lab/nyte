import type { CredentialSource, HostId } from "@nyte-ai/sdk";

export interface HostEndpoint {
  readonly url: string;
  readonly credentials: CredentialSource;
  readonly expect?: { readonly hostId: HostId };
  readonly mediaOrigin?: string;
}

export interface ConnectionProblem {
  readonly kind: "authentication" | "network" | "incompatible" | "server";
  readonly message: string;
}
