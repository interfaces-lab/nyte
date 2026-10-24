import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type { ConnectView } from "@nyte-ai/connect";
import { sdk } from "@nyte-ai/sdk/client";
import type { Connection } from "@nyte-ai/sdk";
import { serviceConnect } from "@nyte-ai/service";
import type { LocalEndpoint } from "@nyte-ai/service";
import { hostAnswers } from "./host-endpoint.ts";
import { OWN_TOKEN_AUTHORITY, startHostThread } from "./hosting.ts";
import type { RemoteFacts } from "./model/state.ts";

const RETRY_MS = 1_000;

/** Probes in a row an attached host must miss before it counts as gone; a revoked host relaunches within them. */
const MISSED_PROBES = 5;

/** Where a command's host lives: a thread this process starts, or a `nyte host` another process runs. */
export type HostSource =
  | { readonly kind: "local" }
  | { readonly kind: "attached"; readonly endpoint: LocalEndpoint };

export interface HostSession {
  readonly connection: Connection;
  readonly endpoint: LocalEndpoint;
  /** Settles with the reason once the host is gone: the thread failed, or the attached host stopped answering. */
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

/** Connects to a host another process serves. Closing it leaves that host running; its revocations, relaunches and relay stay with it. */
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

export function followRemote(
  endpoint: LocalEndpoint,
  signal: AbortSignal,
  report: (remote: RemoteFacts) => void,
  failed: (cause: unknown) => void,
): void {
  void (async () => {
    while (!signal.aborted) {
      await watchRemote(endpoint, signal, report).catch((cause: unknown) => {
        if (!signal.aborted) failed(cause);
      });
      await sleep(RETRY_MS, undefined, { signal }).catch(() => undefined);
    }
  })();
}

export async function watchRemote(
  endpoint: LocalEndpoint,
  signal: AbortSignal,
  report: (remote: RemoteFacts) => void,
): Promise<void> {
  let holder = false;

  for await (const event of serviceConnect(endpoint).watch(signal)) {
    if (event.kind === "relay") holder = event.holder;

    if (event.kind === "view") report(holder ? remoteFacts(event.view) : { kind: "off" });
  }
}

function remoteFacts(view: ConnectView): RemoteFacts {
  if (view.kind !== "linked") return { kind: "off" };

  switch (view.connection.kind) {
    case "stopped":
      return { kind: "off" };
    case "connecting":
    case "retrying":
      return { kind: "connecting" };
    case "failed":
      return { kind: "interrupted" };
    case "connected":
      break;
    default: {
      const _exhaustive: never = view.connection;

      return _exhaustive;
    }
  }

  switch (view.lease.kind) {
    case "current":
      return { kind: "shared", devices: view.devices.length };
    case "pending":
    case "stopped":
      return { kind: "connecting" };
    case "lapsed":
      return { kind: "interrupted" };
    default: {
      const _exhaustive: never = view.lease;

      return _exhaustive;
    }
  }
}
