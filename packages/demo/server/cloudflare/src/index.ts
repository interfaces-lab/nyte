import { NyteDurableObject, routeNyteRequest, type CloudflareOptions } from "@nyte-ai/cloudflare";
import { configureModels } from "./models.ts";

const encoder = new TextEncoder();

async function hasToken(request: Request, token: string): Promise<boolean> {
  const [presented, expected] = await Promise.all(
    [request.headers.get("authorization") ?? "", `Bearer ${token}`].map((value) =>
      crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
  );

  const left = new Uint8Array(presented);
  const right = new Uint8Array(expected);

  return (
    left.reduce((difference, byte, index) => difference | (byte ^ (right[index] ?? 0)), 0) === 0
  );
}

function logFailure(details: { route: string; cause: unknown }): void {
  console.error(
    JSON.stringify({
      event: "nyte.do.failure",
      route: details.route,
      name: details.cause instanceof Error ? details.cause.name : "unknown",
    }),
  );
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return routeNyteRequest({
      request,
      namespace: env.NYTE,
      authorize: async (request) =>
        (await hasToken(request, env.NYTE_TOKEN))
          ? { kind: "allow", tenant: "local", environment: "demo" }
          : { kind: "deny", status: 401 },
    });
  },
} satisfies ExportedHandler<Env>;

export class NyteHost extends NyteDurableObject<Env> {
  protected configure(): CloudflareOptions {
    return {
      nyte: { ...configureModels(this.env), plugins: [], env: { cwd: "/tmp" } },
      server: {
        version: "0.0.0-cloudflare-demo",
        auth: { kind: "token", token: this.env.NYTE_TOKEN },
        onError: logFailure,
      },
      onAlarmError: (cause) => logFailure({ route: "alarm", cause }),
    };
  }
}
