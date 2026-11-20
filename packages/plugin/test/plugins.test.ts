import { checkPlugins } from "@nyte-ai/core/testing";
import { getSystemMessageText } from "@nyte-ai/schema/model";
import { assert, describe, expect, expectTypeOf, it } from "vitest";
import type { Plugin as ClientPlugin } from "../src/client.ts";
import type { Plugin as CorePlugin } from "../src/core.ts";
import bashDescription from "../src/bash-description.ts";
import browserTools from "../src/browser-tools.ts";
import canvasPlugin from "../src/canvas/canvas.ts";
import codemode from "../src/codemode.ts";
import notifications from "../src/client/notifications.ts";
import astraContext from "../src/openai-astra-context.ts";
import { openaiCompaction } from "../src/openai-compaction.ts";
import question from "../src/question/question.ts";
import rename from "../src/rename.ts";
import subagents from "../src/subagents.ts";
import threads from "../src/threads.ts";
import reactRenderers from "../src/client/transcript.tsx";
import tuiRenderers from "../src/client/transcript-tui.ts";
import questions from "../src/question/client/questions.tsx";
import tuiQuestions from "../src/question/client/questions-tui.ts";
import telemetry from "../src/telemetry.ts";
import web from "../src/web/index.ts";
import { fakeModels, open, startChat, until } from "./fake-models.ts";

const core: readonly CorePlugin[] = [
  question,
  rename,
  bashDescription,
  web,
  codemode,
  openaiCompaction({ getModel: () => undefined, getAuth: async () => undefined }),
  astraContext,
  telemetry,
  canvasPlugin,
  browserTools,
];

const client: readonly ClientPlugin[] = [
  notifications,
  reactRenderers,
  tuiRenderers,
  questions,
  tuiQuestions,
];

describe("the plugins", () => {
  it("pass the preflight together with no collisions, never under a reserved id", () => {
    const report = checkPlugins(core);

    expect(report.plugins.map((outcome) => [outcome.id, outcome.kind, outcome.issues])).toEqual(
      core.map((plugin) => [plugin.id, "activated", []]),
    );
    expect(report.collisions).toEqual([]);
    expect(
      [...core, ...client]
        .map((plugin) => plugin.id)
        .filter((id) => id === "models" || id === "settings"),
    ).toEqual([]);
  });

  it("activate together in one session without issues", async () => {
    await using host = await open(fakeModels(), core);
    const { session } = await host.sessions.start({ content: "Hi." });
    await host.kernel.plugins.runtime(session.id).ready;

    expect(host.kernel.host.current().plugins.filter((row) => row.issues.length > 0)).toEqual([]);
    expect((await session.view()).catalog.tools.map((info) => info.name)).toEqual(
      expect.arrayContaining([
        "question",
        "web_search",
        "web_fetch",
        "codemode",
        "canvas_render",
        "browser_open",
        "browser_evaluate",
      ]),
    );
  });

  it("fix the side by subpath: a core plugin takes core hooks and contributions only, a client plugin client ones", () => {
    const hello = {
      id: "hello",
      hooks: {
        before_compaction: (plan) => ({
          ...plan,
          result: { kind: "summary", text: "hello world" },
        }),
      },
    } satisfies CorePlugin;

    const welcome = {
      id: "welcome",
      hooks: { app_ready: (_event, { api }) => api.ui.notify({ message: "Welcome." }) },
    } satisfies ClientPlugin;

    expectTypeOf(hello).toExtend<CorePlugin>();
    expectTypeOf(welcome).toExtend<ClientPlugin>();
    expectTypeOf<{
      readonly id: "x";
      readonly hooks: { readonly app_ready: () => void };
    }>().not.toExtend<CorePlugin>();
    expectTypeOf<{
      readonly id: "x";
      readonly hooks: { readonly run_ended: () => void };
    }>().not.toExtend<ClientPlugin>();
    expectTypeOf<{
      readonly id: "x";
      readonly contribute: { readonly tools: readonly [] };
    }>().not.toExtend<ClientPlugin>();
    expectTypeOf<{
      readonly id: "x";
      readonly contribute: { readonly renderers: readonly [] };
    }>().not.toExtend<CorePlugin>();
  });
});

const DELEGATING = [
  "task",
  "create",
  "send",
  "await",
  "read_agent",
  "stop",
  "thread_start",
  "thread_list",
];

const SUBAGENTS_PROMPT = "Enabled models, for the model of task and create";

const byName = (left: string, right: string): number => left.localeCompare(right);

describe("what each chat is offered", () => {
  it.each([
    ["main", DELEGATING, true],
    ["side", [], false],
    ["subagent", [], false],
  ] as const)(
    "a %s chat is offered the subagent and thread tools %j, and the subagents prompt: %j",
    async (chat, tools, prompt) => {
      const fake = fakeModels();
      await using host = await open(fake, [subagents, threads]);

      const started = await startChat(host, fake, chat, [
        { content: [{ type: "text", text: "Done." }] },
      ]);

      assert((await started.receipt.settled()).kind === "completed");
      const system = fake.requests[started.first]?.context.messages[0];

      assert(system?.role === "system");
      expect(
        (system.toolsAdded ?? [])
          .map((info) => info.name)
          .filter((name) => DELEGATING.includes(name))
          .toSorted(byName),
      ).toEqual(tools.toSorted(byName));
      expect(getSystemMessageText(system).includes(SUBAGENTS_PROMPT)).toBe(prompt);
      expect(
        (await started.session.view()).catalog.tools
          .map((info) => info.name)
          .filter((name) => DELEGATING.includes(name))
          .toSorted(byName),
      ).toEqual(tools.toSorted(byName));
    },
  );

  it("offers web_search while a provider is chosen and withdraws it, in a live chat, once the provider is off", async () => {
    const fake = fakeModels();
    await using host = await open(fake, [web]);
    const started = await startChat(host, fake, "main", [
      { content: [{ type: "text", text: "Done." }] },
    ]);

    assert((await started.receipt.settled()).kind === "completed");

    const offered = async (): Promise<readonly string[]> =>
      (await started.session.view()).catalog.tools
        .map((info) => info.name)
        .filter((name) => name.startsWith("web_"))
        .toSorted(byName);

    expect(await offered()).toEqual(["web_fetch", "web_search"]);
    expect(await host.settings.apply("web_search.provider", "off")).toEqual({ kind: "applied" });
    await until(async () => ((await offered()).includes("web_search") ? undefined : true));

    expect(await offered()).toEqual(["web_fetch"]);
    expect(await host.settings.apply("web_search.provider", "tavily")).toEqual({ kind: "applied" });
    await until(async () => ((await offered()).includes("web_search") ? true : undefined));

    expect(await offered()).toEqual(["web_fetch", "web_search"]);
  });
});
