import process from "node:process";
import type { ConnectRuntime, ConnectShare } from "@nyte-ai/connect/host";
import { operationsDigest } from "@nyte-ai/protocol";
import { serviceBuild } from "./build.ts";
import { Lifetime } from "./lifetime.ts";
import type { LifetimeOptions } from "./lifetime.ts";
import { removeRegistration, writeRegistration } from "./registration.ts";
import type { Registration } from "./registration.ts";
import { SERVICE_ROUTES, serviceRoutes } from "./routes.ts";
import { attachClient, connectRoutes, Sharing } from "./service.ts";

export interface DesktopService {
  readonly before: (request: Request) => Response | Promise<Response> | undefined;
  register(listener: { readonly url: string; readonly hostId: string }): Promise<void>;
  connectChanged(): void;
  close(): Promise<void>;
}

const APP_LIFETIME: LifetimeOptions = {
  grace: 0,
  timers: { wait: () => () => undefined },
  idle: () => undefined,
};

export function desktopService(options: {
  readonly home: string;
  readonly token: string;
  readonly version: string;
  readonly connect: ConnectRuntime;
  readonly share: ConnectShare;
}): DesktopService {
  const lifetime = new Lifetime(
    APP_LIFETIME,
    async () => true,
    async () => true,
  );

  const sharing = new Sharing(options.connect, options.share);
  let registration: Registration | undefined;

  const route = async (request: Request, pathname: string): Promise<Response> => {
    if (request.method === "GET" && pathname === SERVICE_ROUTES.attach)
      return attachClient(request, lifetime);

    if (request.method === "GET" && pathname === SERVICE_ROUTES.clients)
      return Response.json(await lifetime.clients());

    return connectRoutes(request, pathname, options.connect, sharing);
  };

  return {
    before: serviceRoutes(options.token, route),
    async register(listener) {
      registration = {
        url: listener.url,
        token: options.token,
        pid: process.pid,
        version: await serviceBuild(options.version, undefined),
        hostId: listener.hostId,
        owner: "desktop",
        operations: await operationsDigest(),
      };

      await writeRegistration(options.home, registration);
    },
    connectChanged: () => sharing.changed(),
    async close() {
      lifetime.close();
      sharing.close();

      if (registration !== undefined) await removeRegistration(options.home, registration);
    },
  };
}
