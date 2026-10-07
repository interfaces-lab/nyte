/**
 * `@nyte-ai/serve/headless`: a host runtime behind `@nyte-ai/server/node`.
 * The runtime decides who the caller is and what they may do; this module
 * binds that to one address, names the host's identity on the wire, and
 * reports `workspaces: registry` so a client targets registered folders
 * rather than a shared cursor. No web app is resolved here; a packaged
 * headless binary carries none.
 */
import { APP_ORIGINS } from "@nyte-ai/app/web/origins.ts";
import type { HostRuntime } from "@nyte-ai/host/runtime";
import type { ServerPermissions } from "@nyte-ai/server";
import { serve } from "@nyte-ai/server/node";
import type { ServeOptions as ListenOptions, Serving } from "@nyte-ai/server/node";

export interface HeadlessOptions extends Pick<
  ListenOptions,
  "hostname" | "port" | "browserOrigins" | "handle" | "onError"
> {
  readonly runtime: HostRuntime;
  readonly version: string;
}

/** The runtime's judgement, in the server's shape. Both are keyed by the same operation names. */
function permissionsOf(runtime: HostRuntime): ServerPermissions {
  return {
    calls: runtime.permissions.calls,
    environment: runtime.permissions.environment,
    watch: runtime.permissions.watch,
  };
}

export function startHeadless(options: HeadlessOptions): Promise<Serving> {
  const { runtime } = options;

  return serve({
    hostname: options.hostname,
    port: options.port,
    handle: options.handle,
    onError: options.onError,
    sdk: runtime.sdk,
    environment: runtime.environment,
    version: options.version,
    describe: () => ({ capabilities: { workspace: true }, persistence: "durable" }),
    identity: {
      hostId: runtime.profile.hostId,
      publicKey: runtime.profile.publicKey,
      sign: (nonce) => runtime.sign(nonce),
    },
    workspaces: { kind: "registry" },
    auth: { kind: "custom", authorize: (request) => runtime.authorize(request) },
    permissions: permissionsOf(runtime),
    browserOrigins: [...APP_ORIGINS, ...(options.browserOrigins ?? [])],
  });
}
