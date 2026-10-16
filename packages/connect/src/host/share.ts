import type { Host } from "@nyte-ai/core";
import { asId } from "@nyte-ai/schema";
import type { Authority } from "@nyte-ai/schema";
import type { ConnectShare } from "./runtime.ts";

const PARTICIPANT: ReadonlySet<Authority> = new Set(["participant"]);

const OWNER: ReadonlySet<Authority> = new Set(["participant", "owner"]);

export function hostShare(host: Pick<Host, "listen">): ConnectShare {
  return async (listen) => {
    const listener = await host.listen({
      transport: { kind: "http", hostname: "127.0.0.1" },
      auth: {
        kind: "custom",
        authorize: async (request) => {
          const decision = await listen.authorize(request);

          if (decision.kind === "deny") return { deny: decision.reason };

          return {
            principal: asId(decision.principal),
            authority: decision.device.role === "owner" ? OWNER : PARTICIPANT,
          };
        },
      },
      before: listen.handle,
    });

    if (listener.address === null) {
      await listener.close();

      throw new Error("The share listener bound no address.");
    }

    return {
      port: Number(new URL(listener.address).port),
      disconnectClients: () => listener.disconnectClients(),
      close: () => listener.close(),
    };
  };
}
