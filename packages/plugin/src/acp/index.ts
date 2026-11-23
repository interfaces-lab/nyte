import { lazyStream } from "@nyte-ai/ai";
import type { Api, Model, Provider, SimpleStreamOptions, TranscriptContext } from "@nyte-ai/ai";
import { standard } from "@nyte-ai/schema";
import type { ToolDefinition } from "@nyte-ai/core";
import type { Plugin } from "../core.ts";
import { agentCatalog } from "./catalog.ts";
import type { AgentRoute } from "./catalog.ts";
import { createAcpClient } from "./client.ts";
import type { AcpAgent } from "./profiles.ts";
import type { MirrorArguments } from "./projection.ts";
import { mirrorArguments, mirrorClass, MIRROR_TOOL } from "./projection.ts";

export type { AcpClientServices, GatewayLease } from "./client-services.ts";

import type { AcpClientServices } from "./client-services.ts";

export type { AcpAgent } from "./profiles.ts";

export {
  antigravityProfile,
  claudeProfile,
  copilotProfile,
  devinProfile,
  standardProfile,
} from "./profiles.ts";

const mirror: ToolDefinition<MirrorArguments> = {
  name: MIRROR_TOOL,
  description: "Records an operation performed by an external agent.",
  parameters: standard(mirrorArguments),
  exposure: "hidden",
  asks: "runtime",
  changes: "none",
  rerun: "safe",
  class: mirrorClass,
  async execute(args) {
    if (args.result.kind === "failed" || args.result.kind === "interrupted") {
      throw new Error(args.result.text);
    }
    return { content: [{ kind: "text", text: args.result.text }] };
  },
};

export function acpAgents(
  agents: readonly AcpAgent[],
  services?: AcpClientServices,
): readonly Plugin[] {
  const client = createAcpClient(services);

  return [
    { id: "acp", contribute: { tools: [mirror] } },
    ...agents.map((agent): Plugin => ({
      id: agent.id,
      provider: agentProvider(agent, client),
      activate(api) {
        client.bind(agent, api);

        return {};
      },
    })),
  ];
}

function agentProvider(agent: AcpAgent, client: ReturnType<typeof createAcpClient>): Provider {
  let routes: readonly AgentRoute[] = [];

  const stream = (model: Model<Api>, context: TranscriptContext, options?: SimpleStreamOptions) =>
    lazyStream(model, async () => {
      const route = routes.find((candidate) => candidate.model.id === model.id);

      if (route === undefined) throw new Error(`${model.name} is not installed on this machine.`);

      return client.answer(route, model, context, options);
    });

  return {
    id: agent.id,
    name: agent.name,
    baseUrl: `process://acp/${agent.id}`,
    capabilities: { steer: false },
    contextManagement: "provider",
    explicitOnly: true,
    auth: {
      apiKey: {
        name: `${agent.name} on this machine`,
        resolve: async ({ signal }) => {
          signal.throwIfAborted();

          return routes.length === 0 ? undefined : { auth: {}, source: agent.name };
        },
      },
    },
    getModels: () => routes.map((route) => route.model),
    refreshModels: async (context) => {
      const catalog = await agentCatalog(agent, context);
      await context.publish({
        persist: catalog.persist,
        update: () => {
          routes = catalog.routes;
        },
      });
    },
    stream: (model, context, options) =>
      stream(model, context, {
        execution: options?.execution,
        signal: options?.signal,
        sessionId: options?.sessionId,
      }),
    streamSimple: stream,
  };
}
