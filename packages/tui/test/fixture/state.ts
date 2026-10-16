import { asId } from "@nyte-ai/schema";
import type { ModelCatalogView } from "@nyte-ai/sdk";
import type { ResolvedSettings } from "../../src/lib/settings-schema.ts";
import { initialState } from "../../src/model/state.ts";
import type { FollowedSession, State } from "../../src/model/state.ts";

export const SETTINGS: ResolvedSettings = {
  autoUpdate: false,
  theme: "auto",
  copyOnSelect: false,
  scrollAcceleration: false,
  followUp: "steer",
};

export const CATALOG: ModelCatalogView = {
  generation: asId("gen-1"),
  default: { provider: "test", id: "model" },
  providers: [
    {
      id: "test",
      name: "Test",
      credential: "configured",
      methods: [{ kind: "key" }],
      limits: [],
      models: [
        {
          ref: { provider: "test", id: "model" },
          name: "Model",
          reasoning: true,
          thinking: ["off", "low", "medium", "high"],
          defaultThinking: "low",
          fast: { provider: "test", id: "model-fast" },
          contextWindow: 100_000,
          compactAt: 80_000,
          maxOutput: 8_000,
          input: ["text", "image"],
          cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
        },
        {
          ref: { provider: "test", id: "model-fast" },
          name: "Model Fast",
          reasoning: false,
          thinking: ["off"],
          defaultThinking: "off",
          fast: null,
          contextWindow: 100_000,
          compactAt: 80_000,
          maxOutput: 8_000,
          input: ["text"],
          cost: { input: 0.5, output: 1, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    },
  ],
};

export function buildState(
  session: FollowedSession | null,
  overrides?: { readonly cwd?: string; readonly catalog?: ModelCatalogView | null },
): State {
  const cwd = overrides?.cwd ?? "/tmp/fake-workspace";

  const base = initialState({
    cwd,
    settings: SETTINGS,
    terminal: { width: 100, height: 32, theme: "dark", selection: false, dragging: false },
    chat: null,
  });

  return {
    facts: {
      ...base.facts,
      host: "open",
      chat: session,
      catalog: {
        generation: 1,
        catalog: overrides?.catalog === undefined ? CATALOG : overrides.catalog,
      },
      workspace: { cwd, branch: null, dirty: false, mentions: null },
    },
    local: base.local,
  };
}
