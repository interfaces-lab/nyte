import { connect } from "./connect.ts";

export { createSendJournal } from "./journal.ts";

export { openHost } from "./host-connection.ts";

export type {
  Health,
  HostConnection,
  HostCredentials,
  HostOptions,
  Live,
  OpenSocket,
  SocketRequest,
} from "./host-connection.ts";

export * from "./surface.ts";

/**
 * The SDK for a client of a host in another process: `connect` without `open`, so
 * importing it never loads the host, its models or its store.
 */
export const sdk = { connect };
