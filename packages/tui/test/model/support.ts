import { asId } from "@nyte-ai/schema";
import type { ModelCatalogView, ModelInfo, SessionView } from "@nyte-ai/sdk";
import type { Msg } from "../../src/model/msg.ts";
import { reduce } from "../../src/model/reduce.ts";
import type { Step } from "../../src/model/step.ts";
import { initialState } from "../../src/model/state.ts";
import type { State } from "../../src/model/state.ts";
import { followed } from "../fixture/view.ts";

export const NOW = 1_000_000;

export function model(
  id: string,
  thinking: ModelInfo["thinking"] = ["off", "low", "medium", "high"],
): ModelInfo {
  return {
    ref: { provider: "test", id },
    name: id,
    reasoning: true,
    thinking,
    defaultThinking: thinking.find((level) => level !== "off") ?? "off",
    fast: null,
    contextWindow: 100_000,
    compactAt: 90_000,
    maxOutput: 8_000,
    input: ["text"],
    capabilities: { steer: true, stopSubagent: true, ownPermissions: false },
    cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
  };
}

export const CATALOG: ModelCatalogView = {
  generation: asId("gen-1"),
  default: { provider: "test", id: "model" },
  providers: [
    {
      id: "test",
      name: "Test",
      credential: "verified",
      methods: [{ kind: "key" }],
      limits: [],
      models: [model("model"), model("other", ["off", "high"])],
    },
  ],
};

export function blank(): State {
  return initialState({
    cwd: "/w",
    settings: {
      autoUpdate: false,
      theme: "dark",
      copyOnSelect: false,
      scrollAcceleration: false,
      followUp: "steer",
    },
    terminal: { width: 100, height: 32, theme: "dark", selection: false, dragging: false },
    chat: null,
  });
}

export function play(state: State, ...msgs: readonly Msg[]): Step {
  let current = state;
  const effects: Step["effects"][number][] = [];

  for (const msg of msgs) {
    const step = reduce(current, msg, NOW);
    current = step.state;
    effects.push(...step.effects);
  }

  return { state: current, effects };
}

export function ready(view: SessionView): State {
  const session = followed(view);

  return play(
    blank(),
    { kind: "host-opened" },
    { kind: "catalog", generation: 1, catalog: CATALOG },
    {
      kind: "session-opened",
      session: session.id,
      info: session.info,
      selection: session.selection,
    },
    { kind: "view", session: session.id, view },
  ).state;
}

export function typed(text: string): Msg {
  return {
    kind: "draft-changed",
    text,
    cursor: text.length,
    row: text.includes("\n") ? "last" : "only",
  };
}

export const S1 = asId<"session">("s1");
