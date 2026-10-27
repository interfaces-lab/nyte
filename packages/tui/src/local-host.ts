import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { sdk } from "@nyte-ai/sdk/client";
import type { Connection } from "@nyte-ai/sdk";
import type { LocalEndpoint } from "@nyte-ai/service";
import { hostAnswers } from "./host-endpoint.ts";
import { OWN_TOKEN_AUTHORITY, startHostThread } from "./hosting.ts";

const RETRY_MS = 1_000;

const MISSED_PROBES = 5;

export type HostSource =
  | { readonly kind: "local" }
  | { readonly kind: "attached"; readonly endpoint: LocalEndpoint };

export interface HostSession {
  readonly connection: Connection;
  readonly endpoint: LocalEndpoint;
  readonly ended: Promise<Error>;
  close(): Promise<void>;
}

export function connectHost(source: HostSource): Promise<HostSession> {
  switch (source.kind) {
    case "local":
      return connectLocalHost();
    case "attached":
      return attachHost(source.endpoint);
    default: {
      const _exhaustive: never = source;

      return _exhaustive;
    }
  }
}

export async function connectLocalHost(): Promise<HostSession> {
  const token = randomBytes(32).toString("base64url");

  const thread = await startHostThread({
    kind: "local",
    port: 0,
    token,
    authority: OWN_TOKEN_AUTHORITY,
  });

  const connection = await sdk
    .connect({ url: thread.address, credentials: { kind: "token", token } })
    .catch(async (cause: unknown) => {
      await thread.stop();

      throw cause;
    });

  return {
    connection,
    endpoint: { url: thread.address, token },
    ended: thread.ended.then(
      () => new Error("The host thread stopped."),
      (cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause))),
    ),
    async close() {
      await connection.close().catch(() => undefined);
      await thread.stop();
    },
  };
}

async function attachHost(endpoint: LocalEndpoint): Promise<HostSession> {
  const connection = await sdk
    .connect({ url: endpoint.url, credentials: { kind: "token", token: endpoint.token } })
    .catch((cause: unknown) => {
      throw new Error(
        `Couldn't attach to the Nyte host at ${endpoint.url}: ${cause instanceof Error ? cause.message : String(cause)}`,
        { cause },
      );
    });

  const watching = new AbortController();

  return {
    connection,
    endpoint,
    ended: untilGone(endpoint.url, watching.signal),
    async close() {
      watching.abort();
      await connection.close().catch(() => undefined);
    },
  };
}

async function untilGone(url: string, signal: AbortSignal): Promise<Error> {
  for (let missed = 0; missed < MISSED_PROBES;) {
    const waited = await sleep(RETRY_MS, true, { signal }).catch(() => false);

    if (!waited) return new Promise<never>(() => undefined);
    missed = (await hostAnswers(url)) ? 0 : missed + 1;
  }

  return new Error(`The Nyte host at ${url} stopped. Start \`nyte host\` again, then reopen nyte.`);
}
