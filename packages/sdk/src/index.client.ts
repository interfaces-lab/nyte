import { connect } from "./connect.ts";

export { createSendJournal } from "./journal.ts";

export { openHost } from "./host-connection.ts";

export type {
  ActionHandler,
  Health,
  HostConnection,
  HostCredentials,
  HostOptions,
  OpenSocket,
  Requester,
  SocketRequest,
  TextUpdate,
} from "./host-connection.ts";

export type { ClientsStore } from "./live-clients.ts";

export type { SessionsStore, SessionsSnapshot, SessionsWindow } from "./live-sessions.ts";

export type { HeadRows, HeadSnapshot, HeadStore } from "./live-head.ts";

export type { Freshness, Live } from "./live.ts";

export * from "./surface.ts";

/**
 * The SDK for a client of a host in another process: `connect` without `open`, so
 * importing it never loads the host, its models or its store.
 */
export const sdk = { connect };
