/**
 * Fast mode from a user's seat: a toggle that changes what the provider is
 * asked for, survives a restart, and follows the provider it was set for.
 */
import assert from "node:assert/strict";
import { afterEach, describe, test } from "vitest";
import type { Nyte, StreamFn } from "@nyte-ai/core";
import { definePlugin, inlinePlugin, systemPromptPlugin } from "@nyte-ai/plugin";
import type { Api, Model } from "@nyte-ai/schema";
import { FAST_MODE_PLUGIN_ID, fastModePlugin, fastModeSettingId } from "../examples/fast-mode.ts";
import type { FastModeModelCatalog } from "../examples/fast-mode.ts";
import { prompt, respond, runCommand, settingOf, testModel, TestWorkspace } from "./host.ts";

const workspaces: TestWorkspace[] = [];
afterEach(async () => {
  for (const opened of workspaces.splice(0)) await opened.close();
});

function workspace(prefix: string): TestWorkspace {
  const created = TestWorkspace.create(prefix);
  workspaces.push(created);
  return created;
}

const fastModel: Model<Api> = {
  ...testModel,
  id: "fast-model",
  name: "Fast model",
  provider: "openai",
  modes: ["fast"],
};

const normalModel: Model<Api> = {
  ...testModel,
  id: "normal-model",
  name: "Normal model",
  provider: "openai",
};

function fastPlugin(
  defaultModel: Model<Api>,
  catalogModels: readonly Model<Api>[] = [defaultModel],
) {
  const models: FastModeModelCatalog = {
    getModels: () => catalogModels,
    getModel: (providerId, id) =>
      catalogModels.find((model) => model.provider === providerId && model.id === id),
  };
  return fastModePlugin({ models, defaultModel });
}

interface ProviderRequest {
  readonly model: string;
  readonly fast: boolean | undefined;
}

interface ScriptedProvider {
  readonly streamFn: StreamFn;
  readonly requests: readonly ProviderRequest[];
}

/** A provider that answers "done" and records what each request asked for. */
function provider(): ScriptedProvider {
  const requests: ProviderRequest[] = [];
  const streamFn: StreamFn = (model, _context, options) => {
    requests.push({ model: model.id, fast: options?.fast });
    return respond(model, [{ type: "text", text: "done" }]);
  };
  return { streamFn, requests };
}

const fastOf = (requests: readonly ProviderRequest[]) => requests.map((request) => request.fast);

describe("fast mode plugin", () => {
  test("a toggle reaches the provider, survives a restart, and leaves compaction on the normal tier", async () => {
    const world = workspace("nyte-fast-mode-");
    const { streamFn, requests } = provider();
    const plugins = [inlinePlugin(systemPromptPlugin("sys")), inlinePlugin(fastPlugin(fastModel))];
    const open = (): Promise<Nyte> =>
      world.open({
        streamFn,
        plugins,
        model: fastModel,
        compaction: { enabled: true, reserveTokens: 100, keepRecentTokens: 1 },
      });

    let sdk = await open();
    const { sessionId } = world;
    const settingId = fastModeSettingId(fastModel.provider);

    assert.equal(await settingOf(sdk, sessionId, settingId), "off");
    assert.equal(await runCommand(sdk, sessionId, "fast"), "Fast mode: on");
    assert.equal(await settingOf(sdk, sessionId, settingId), "on");
    await prompt(sdk, sessionId, "one");
    await prompt(sdk, sessionId, "two");
    assert.deepEqual(fastOf(requests), [true, true]);

    const beforeCompaction = requests.length;
    const compacted = await sdk.runs.compact({ sessionId });
    assert.equal(compacted.kind, "compacted", JSON.stringify(compacted));
    const compactionRequests = requests.slice(beforeCompaction);
    assert.ok(compactionRequests.length > 0, "compaction asked the model for a summary");
    assert.deepEqual(
      fastOf(compactionRequests),
      compactionRequests.map(() => undefined),
    );
    await sdk.close();

    // A second host over the same store sees the selection without being told.
    sdk = await open();
    assert.equal(await settingOf(sdk, sessionId, settingId), "on");
    await prompt(sdk, sessionId, "three");
    assert.equal(requests.at(-1)?.fast, true);

    // Later plugins patch over earlier ones.
    await sdk.setPlugins([
      ...plugins,
      inlinePlugin(
        definePlugin({
          id: "normal-tier",
          session(api) {
            api.hook("before_request", () => ({ streamOptions: { fast: false } }));
          },
        }),
      ),
    ]);
    await prompt(sdk, sessionId, "four");
    assert.equal(requests.at(-1)?.fast, false);
  });

  test("keeps a selection with the provider it was made for", async () => {
    const world = workspace("nyte-fast-mode-provider-");
    // Same session, same advertised mode, different price per token.
    const otherModel: Model<Api> = { ...fastModel, id: "other-fast-model", provider: "anthropic" };
    const catalog = [fastModel, otherModel];
    const { streamFn, requests } = provider();
    const open = (model: Model<Api>): Promise<Nyte> =>
      world.open({
        streamFn,
        plugins: [inlinePlugin(fastPlugin(model, catalog))],
        model,
        models: catalog,
      });

    let sdk = await open(fastModel);
    const { sessionId } = world;
    assert.equal(await runCommand(sdk, sessionId, "fast"), "Fast mode: on");
    await prompt(sdk, sessionId, "one");
    assert.deepEqual(requests.at(-1), { model: fastModel.id, fast: true });
    await sdk.close();

    sdk = await open(otherModel);
    assert.equal(await settingOf(sdk, sessionId, fastModeSettingId("openai")), "on");
    assert.equal(await settingOf(sdk, sessionId, fastModeSettingId("anthropic")), "off");
    await prompt(sdk, sessionId, "two");
    assert.deepEqual(requests.at(-1), { model: otherModel.id, fast: undefined });
    await sdk.close();

    sdk = await open(fastModel);
    await prompt(sdk, sessionId, "three");
    assert.deepEqual(requests.at(-1), { model: fastModel.id, fast: true });
  });

  test("checks the requested model instead of the host fallback", async () => {
    const world = workspace("nyte-fast-mode-selected-model-");
    const { streamFn, requests } = provider();
    const catalog = [normalModel, fastModel];
    const sdk = await world.open({
      streamFn,
      plugins: [inlinePlugin(fastPlugin(normalModel, catalog))],
      model: normalModel,
      models: catalog,
    });
    const { sessionId } = world;

    assert.deepEqual(
      await sdk.plugins.settings.apply({
        sessionId,
        id: fastModeSettingId(fastModel.provider),
        choiceId: "on",
      }),
      { kind: "applied" },
    );
    await prompt(sdk, sessionId, "normal");
    assert.deepEqual(requests.at(-1), { model: normalModel.id, fast: undefined });

    const configured = await sdk.sessions.configure({
      sessionId,
      model: { provider: fastModel.provider, id: fastModel.id },
    });
    assert.equal(configured.kind, "queued");
    await prompt(sdk, sessionId, "fast");
    assert.deepEqual(requests.at(-1), { model: fastModel.id, fast: true });
  });

  test("the setting and the command move the same switch", async () => {
    const world = workspace("nyte-fast-mode-apply-");
    const { streamFn, requests } = provider();
    const sdk = await world.open({
      streamFn,
      plugins: [inlinePlugin(fastPlugin(fastModel))],
      model: fastModel,
    });
    const { sessionId } = world;
    const settingId = fastModeSettingId(fastModel.provider);

    const listed = await sdk.plugins.settings.list({ sessionId });
    assert.deepEqual(
      listed.map(({ id, owner, current }) => ({ id, owner, current })),
      [{ id: settingId, owner: FAST_MODE_PLUGIN_ID, current: "off" }],
    );
    assert.deepEqual(
      listed[0]?.choices.map((choice) => [choice.id, choice.status]),
      [
        ["on", "fast"],
        ["off", undefined],
      ],
    );

    const apply = (id: string, choiceId: string) =>
      sdk.plugins.settings.apply({ sessionId, id, choiceId });
    assert.deepEqual(await apply(settingId, "on"), { kind: "applied" });
    assert.equal(await settingOf(sdk, sessionId, settingId), "on");
    await prompt(sdk, sessionId, "one");
    assert.equal(requests.at(-1)?.fast, true);

    // The command toggles what the setting wrote.
    assert.equal(await runCommand(sdk, sessionId, "fast"), "Fast mode: off");
    assert.equal(await settingOf(sdk, sessionId, settingId), "off");
    await prompt(sdk, sessionId, "two");
    assert.equal(requests.at(-1)?.fast, undefined);

    assert.deepEqual(await apply(settingId, "sideways"), { kind: "invalid_choice" });
    assert.deepEqual(await apply("missing", "on"), { kind: "not_found" });
  });

  test("contributes nothing when the selected model does not advertise fast mode", async () => {
    const world = workspace("nyte-fast-mode-unavailable-");
    const { streamFn, requests } = provider();
    const sdk = await world.open({
      streamFn,
      plugins: [inlinePlugin(fastPlugin(normalModel))],
      model: normalModel,
    });
    const { sessionId } = world;

    assert.deepEqual(await sdk.plugins.commands.list({ sessionId }), []);
    assert.deepEqual(await sdk.plugins.settings.list({ sessionId }), []);
    assert.deepEqual(await sdk.plugins.commands.run({ sessionId, name: "fast" }), {
      kind: "not_found",
    });
    await prompt(sdk, sessionId, "one");
    assert.deepEqual(requests, [{ model: normalModel.id, fast: undefined }]);
  });
});
