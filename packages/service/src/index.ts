export {
  ensureService,
  findService,
  followService,
  installService,
  readSupervision,
  retireService,
  serviceClients,
  serviceConnect,
  stopService,
  uninstallService,
} from "./client.ts";
export type {
  Following,
  Installed,
  Retirement,
  ServiceConnect,
  Stopped,
  Supervision,
} from "./client.ts";
export { desktopService } from "./desktop.ts";
export type { DesktopService } from "./desktop.ts";
export { IDLE_GRACE_MS } from "./lifetime.ts";
export type { LifetimeOptions, Timers } from "./lifetime.ts";
export { portConflict, probePort } from "./port.ts";
export { serviceBuild } from "./build.ts";
export {
  readRegistration,
  writeRegistration,
  removeRegistration,
  watchReplacement,
} from "./registration.ts";
export type { Owner, Registration } from "./registration.ts";
export type { Busy, Handoff, ServiceClient } from "./routes.ts";
export { PortInUse, ServiceRunning, startService, stopHostJobs } from "./service.ts";
export { commandLink, logPath } from "./supervisor.ts";
export type { Supervisor } from "./supervisor.ts";
