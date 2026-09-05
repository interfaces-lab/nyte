import assert from "node:assert/strict";
import { describe, test } from "vitest";
import type { DesktopCatalog, DesktopModelOption, ProviderStatus } from "../../../shared/ipc.ts";
import {
  formatContextWindow,
  formatPricing,
  modelTriggerLabel,
  pickerGroups,
  supportedThinkingLevel,
  THINKING_LABELS,
  thinkingLevelsFor,
} from "./model-picker-state.ts";

function option(overrides: Partial<DesktopModelOption> = {}): DesktopModelOption {
  return {
    key: "anthropic/claude",
    provider: "anthropic",
    id: "claude",
    name: "Claude",
    contextWindow: 200_000,
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    fastMode: { kind: "unavailable" },
    thinkingLevels: ["off"],
    hidden: false,
    listed: true,
    ...overrides,
  };
}

function provider(overrides: Partial<ProviderStatus> = {}): ProviderStatus {
  return {
    id: "anthropic",
    name: "Anthropic",
    enabled: true,
    connection: { kind: "oauth" },
    signIn: [],
    ...overrides,
  };
}

const claude = option();
const gpt = option({
  key: "openai/gpt-5.6",
  provider: "openai",
  id: "gpt-5.6",
  name: "GPT 5.6",
  thinkingLevels: ["off", "low", "medium", "high"],
});
const hidden = option({
  key: "openai/gpt-4",
  provider: "openai",
  id: "gpt-4",
  name: "GPT 4",
  hidden: true,
  listed: false,
});
const catalog: DesktopCatalog = {
  providers: [
    provider({ id: "openai", name: "OpenAI", connection: { kind: "api_key", env: undefined } }),
    provider(),
  ],
  models: [gpt, hidden, claude],
  defaults: { model: { provider: "openai", id: "gpt-5.6" }, thinkingLevel: "medium" },
};

describe("model picker state", () => {
  test("groups listed models in provider order and searches names, ids, and providers", () => {
    assert.deepEqual(
      pickerGroups(catalog, undefined, "").map((group) => [group.provider.id, group.options]),
      [
        ["openai", [gpt]],
        ["anthropic", [claude]],
      ],
    );
    assert.deepEqual(
      pickerGroups(catalog, undefined, "anthro").flatMap((group) => group.options),
      [claude],
    );
    assert.deepEqual(
      pickerGroups(catalog, undefined, "5.6").flatMap((group) => group.options),
      [gpt],
    );
    assert.deepEqual(pickerGroups(catalog, undefined, "missing"), []);
  });

  test("keeps the session's model in its group even when it is no longer listed", () => {
    assert.deepEqual(
      pickerGroups(catalog, hidden, "").flatMap((group) => group.options),
      [gpt, hidden, claude],
    );
  });

  test("thinking levels keep catalog order and clamp unsupported selections", () => {
    const reasoning = option({ thinkingLevels: ["max", "low", "high", "medium"] });
    assert.deepEqual(thinkingLevelsFor(reasoning), ["low", "medium", "high", "max"]);
    assert.equal(supportedThinkingLevel(reasoning, "high"), "high");
    assert.equal(supportedThinkingLevel(reasoning, "minimal"), "medium");
    assert.equal(supportedThinkingLevel(option(), "high"), "off");
  });

  test("labels", () => {
    assert.equal(THINKING_LABELS.off, "Off");
    assert.equal(THINKING_LABELS.xhigh, "Extra High");
    assert.equal(formatContextWindow(128_000), "128K");
    assert.equal(formatContextWindow(1_050_000), "1M");
    assert.equal(
      formatPricing({ input: 2.5, output: 15, cacheRead: 0, cacheWrite: 0 }),
      "$2.50 / $15",
    );
    assert.equal(formatPricing({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }), "Free");
  });

  test("the chip names the model and mutes only the parameters that are choices", () => {
    assert.deepEqual(modelTriggerLabel(undefined, "off"), {
      name: "Choose a model",
      detail: undefined,
    });
    assert.deepEqual(modelTriggerLabel(claude, "medium"), { name: "Claude", detail: undefined });
    assert.deepEqual(modelTriggerLabel(gpt, "high", true), {
      name: "GPT 5.6",
      detail: "High · Fast",
    });
    assert.deepEqual(modelTriggerLabel(gpt, "off"), { name: "GPT 5.6", detail: undefined });
    assert.deepEqual(modelTriggerLabel(gpt, undefined), { name: "GPT 5.6", detail: undefined });
  });
});
