/**
 * `@nyte-ai/connect/host`: the Node side of Connect, for any host that links
 * a Nyte account: the link/lease/enrollment lifecycle, its private store,
 * the broker client, the relay socket and the enrollment routes. Nothing here
 * knows about Electron or a renderer; the embedding supplies an
 * `AccountSession` and a `ConnectShare` that binds its listener.
 */
export { AccountCancelled } from "./account.ts";
export type { AccountSession, AccountState } from "./account.ts";
export { ConnectError } from "./errors.ts";
export { ConnectRuntime } from "./runtime.ts";
export type {
  ConnectListen,
  ConnectListener,
  ConnectRuntimeOptions,
  ConnectShare,
  ConnectTiming,
  DeviceDecision,
  HostConnectConfig,
  LinkAuthorizer,
} from "./runtime.ts";
export {
  CONSUMED_LIMIT,
  ConnectStore,
  ConnectStoreFailed,
  EMPTY_CONNECT_FILE,
  REVOCATION_LIMIT,
  UNLINK_LIMIT,
  writePrivateFile,
} from "./store.ts";
export type { ConnectFile, LinkKey, PendingUnlink, StoredDevice, StoredLink } from "./store.ts";
export { DesktopBroker } from "./broker.ts";
export type { BrokerFetch, LeaseAnswer } from "./broker.ts";
export { RelayConnection } from "./relay.ts";
export type { RelayConnectionOptions, RelayDial, RelayTiming } from "./relay.ts";
export { bearerToken, connectRouteHandler, refused, tokenDigest } from "./routes.ts";
export type { AuthorizingRequest, RouteAnswer } from "./routes.ts";
export { machineName } from "./machine-name.ts";
