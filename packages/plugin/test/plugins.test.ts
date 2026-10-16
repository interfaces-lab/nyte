import { checkPlugins } from "../../core/src/extend/plugin-runtime.ts";
import { describe, expect, expectTypeOf, it } from "vitest";
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
import reactRenderers from "../src/client/transcript.tsx";
import tuiRenderers from "../src/client/transcript-tui.ts";
import questions from "../src/question/client/questions.tsx";
import tuiQuestions from "../src/question/client/questions-tui.ts";
import telemetry from "../src/telemetry.ts";
import webSearch from "../src/web-search.ts";
import { fakeModels, open } from "./fake-models.ts";

const core: readonly CorePlugin[] = [
  question,
  rename,
  bashDescription,
  webSearch,
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
    const session = await host.sessions.create();
    await host.kernel.pluginsFor(session.id).ready;

    expect(host.kernel.host.current().plugins.filter((row) => row.issues.length > 0)).toEqual([]);
    expect((await session.view()).catalog.tools.map((info) => info.name)).toEqual(
      expect.arrayContaining([
        "question",
        "web_search",
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
