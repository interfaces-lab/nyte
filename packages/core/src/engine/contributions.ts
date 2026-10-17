import { SdkError } from "@nyte-ai/schema";
import type { ConfigureOutcome } from "@nyte-ai/schema";
import type { Contributions, Kernel, PluginRuntime } from "../contract/kernel.ts";

export type Refusal = Exclude<ConfigureOutcome, { readonly kind: "configured" }>;

export function refusalError(refusal: Refusal): SdkError {
  switch (refusal.kind) {
    case "unknown-model":
      return new SdkError("invalid", `No model is ${refusal.model.provider}/${refusal.model.id}.`, {
        issues: [],
      });
    case "unknown-agent":
      return new SdkError("invalid", `No agent is registered as ${refusal.agent}.`, {
        issues: [],
      });
    case "invalid":
      return new SdkError(
        "invalid",
        `The configuration is invalid: ${refusal.issues.map((found) => found.message).join(" ")}`,
        { issues: refusal.issues },
      );
  }
}

export function collectContributions(runtime: PluginRuntime): Contributions {
  return { agents: runtime.registries.agents.list(), settings: runtime.registries.settings.list() };
}

export function staticContributions(kernel: Kernel): Contributions {
  const plugins = [...kernel.plugins.builtins, ...kernel.plugins.host];

  return {
    agents: plugins.flatMap((plugin) => plugin.contribute?.agents ?? []),
    settings: plugins.flatMap((plugin) => plugin.contribute?.settings ?? []),
  };
}
