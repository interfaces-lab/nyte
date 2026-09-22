import { anthropicProvider } from "@nyte-ai/ai";
import { providerPlugin } from "@nyte-ai/plugin/provider";

const configured = process.env.ANTHROPIC_BASE_URL;

if (configured === undefined) throw new Error("Set ANTHROPIC_BASE_URL to the proxy endpoint.");

const endpoint = new URL(configured);

if (endpoint.protocol !== "https:" && endpoint.protocol !== "http:") {
  throw new Error("ANTHROPIC_BASE_URL must use HTTP or HTTPS.");
}

const baseUrl = endpoint.href.replace(/\/$/, "");

const anthropic = anthropicProvider();

export default providerPlugin({
  id: "anthropic-proxy",
  enabled: false,
  provider: {
    ...anthropic,
    getModels: () => anthropic.getModels().map((model) => ({ ...model, baseUrl })),
  },
});
