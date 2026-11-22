import { expect, test } from "vitest";
import type { ModelInfo, ModelRef, Thinking } from "@nyte-ai/sdk";
import type { DesktopModelOption } from "../../data/catalog.ts";
import { draftModel, sessionModel } from "./model-picker-state.ts";
import type { SessionModel } from "./model-picker-state.ts";

function option(
  id: string,
  change: Partial<DesktopModelOption> = {},
  variants: ModelInfo["variants"] = [],
): DesktopModelOption {
  return {
    key: `test/${id}`,
    provider: "test",
    agent: false,
    id,
    name: id,
    contextWindow: 1000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    thinkingLevels: ["off", "high"],
    defaultThinking: "off",
    info: {
      ref: { provider: "test", id },
      name: id,
      reasoning: true,
      thinking: ["off", "high"],
      defaultThinking: "off",
      variants,
      contextWindow: 1000,
      compactAt: 900,
      maxOutput: 100,
      input: ["text"],
      capabilities: { steer: true },
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    input: ["text"],
    capabilities: { steer: true },
    listing: "shown",
    listed: true,
    ...change,
  };
}

const SWIFT = option("swift", {}, [
  { modes: ["fast"], ref: { provider: "test", id: "swift-fast" } },
]);

const QUEUER = option("queuer", { capabilities: { steer: false } });

const CATALOG = { models: [SWIFT, QUEUER] };

const ref = (id: string, provider = "test"): ModelRef => ({ provider, id });

const NONE: SessionModel = { option: undefined, modes: [], thinking: undefined, steers: true };

test.each<{
  readonly name: string;
  readonly catalog: typeof CATALOG | undefined;
  readonly choice:
    | { readonly model: ModelRef | undefined; readonly thinking: Thinking | undefined }
    | undefined;
  readonly model: SessionModel;
}>([
  { name: "no choice yet", catalog: CATALOG, choice: undefined, model: NONE },
  {
    name: "no catalog yet keeps the thinking level",
    catalog: undefined,
    choice: { model: ref("swift"), thinking: "high" },
    model: { ...NONE, thinking: "high" },
  },
  {
    name: "a listed model",
    catalog: CATALOG,
    choice: { model: ref("swift"), thinking: "off" },
    model: { option: SWIFT, modes: [], thinking: "off", steers: true },
  },
  {
    name: "a model's fast variant picks the model in fast mode",
    catalog: CATALOG,
    choice: { model: ref("swift-fast"), thinking: undefined },
    model: { option: SWIFT, modes: ["fast"], thinking: undefined, steers: true },
  },
  {
    name: "a model the catalog doesn't list steers",
    catalog: CATALOG,
    choice: { model: ref("gone"), thinking: undefined },
    model: NONE,
  },
  {
    name: "the same id from another provider is not the model",
    catalog: CATALOG,
    choice: { model: ref("queuer", "other"), thinking: undefined },
    model: NONE,
  },
  {
    name: "a model that can't steer only queues",
    catalog: CATALOG,
    choice: { model: ref("queuer"), thinking: undefined },
    model: { option: QUEUER, modes: [], thinking: undefined, steers: false },
  },
])("the session model: $name", (row) => {
  expect(sessionModel(row.catalog, row.choice)).toEqual(row.model);
});

test.each<{
  readonly name: string;
  readonly choice: { readonly model: ModelRef } | undefined;
  readonly coordinator: ModelRef | null | undefined;
  readonly defaults: { readonly model: ModelRef } | undefined;
  readonly model: ModelRef | undefined;
}>([
  {
    name: "the draft's pick beats its project and the default",
    choice: { model: ref("picked") },
    coordinator: ref("coordinator"),
    defaults: { model: ref("default") },
    model: ref("picked"),
  },
  {
    name: "the project's coordinator beats the default",
    choice: undefined,
    coordinator: ref("coordinator"),
    defaults: { model: ref("default") },
    model: ref("coordinator"),
  },
  {
    name: "a project with no coordinator falls to the default",
    choice: undefined,
    coordinator: null,
    defaults: { model: ref("default") },
    model: ref("default"),
  },
  {
    name: "no project falls to the default",
    choice: undefined,
    coordinator: undefined,
    defaults: { model: ref("default") },
    model: ref("default"),
  },
  {
    name: "nothing to go on",
    choice: undefined,
    coordinator: null,
    defaults: undefined,
    model: undefined,
  },
])("a draft's model: $name", (row) => {
  const project =
    row.coordinator === undefined ? undefined : { models: { coordinator: row.coordinator } };

  expect(draftModel(row.choice, project, row.defaults)).toEqual(row.model);
});
