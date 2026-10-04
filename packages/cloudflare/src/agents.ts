import { Agent, getAgentByName } from "agents";
import { routeNyteRequest } from "./routing.ts";
import { openCloudflareRuntime, type CloudflareOptions } from "./runtime.ts";

export abstract class NyteAgent<Env extends Cloudflare.Env = Cloudflare.Env> extends Agent<Env> {
  private runtime: ReturnType<typeof openCloudflareRuntime> | undefined;

  protected abstract configureNyte(): CloudflareOptions | Promise<CloudflareOptions>;

  private openNyte() {
    this.runtime ??= (async () =>
      openCloudflareRuntime({
        storage: this.ctx.storage,
        options: await this.configureNyte(),
        arm: async (at) => {
          const scheduled = await this.schedule(
            new Date(at > Date.now() + 1 ? Math.ceil(at / 1000) * 1000 : at),
            "nyteTick",
          );

          for (const { id, callback } of await this.listSchedules({ type: "scheduled" }))
            if (callback === "nyteTick" && id !== scheduled.id) await this.cancelSchedule(id);
        },
      }))().catch((cause: unknown) => {
      this.runtime = undefined;
      throw cause;
    });

    return this.runtime;
  }

  async onStart(): Promise<void> {
    await this.scheduleEvery(30, "nyteTick");
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.has("upgrade")) return new Response(null, { status: 426 });

    return super.fetch(request);
  }

  async onRequest(request: Request): Promise<Response> {
    return (await this.openNyte()).fetch(request);
  }

  async nyteTick(): Promise<void> {
    return (await this.openNyte()).driver.alarm();
  }
}

export function routeNyteAgentRequest<Env extends Cloudflare.Env>(
  options: Omit<Parameters<typeof routeNyteRequest>[0], "namespace"> & {
    namespace: DurableObjectNamespace<NyteAgent<Env>>;
  },
): Promise<Response> {
  return routeNyteRequest({
    ...options,
    namespace: { getByName: (name) => getAgentByName(options.namespace, name) },
  });
}
