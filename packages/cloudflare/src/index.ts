import { DurableObject } from "cloudflare:workers";
import { openCloudflareRuntime, type CloudflareOptions } from "./runtime.ts";

export { routeNyteRequest, type RoutingDecision } from "./routing.ts";

export type { CloudflareOptions } from "./runtime.ts";

export abstract class NyteDurableObject<Env = unknown> extends DurableObject<Env> {
  private runtime: ReturnType<typeof openCloudflareRuntime>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.runtime = ctx.blockConcurrencyWhile(async () => {
      const runtime = await openCloudflareRuntime({
        storage: ctx.storage,
        options: await this.configure(),
        arm: (at) => ctx.storage.setAlarm(at),
      });

      if ((await ctx.storage.getAlarm()) === null) await runtime.driver.wake();

      return runtime;
    });
  }

  protected abstract configure(): CloudflareOptions | Promise<CloudflareOptions>;

  async fetch(request: Request): Promise<Response> {
    return (await this.runtime).fetch(request);
  }

  async alarm(): Promise<void> {
    return (await this.runtime).driver.alarm();
  }
}
