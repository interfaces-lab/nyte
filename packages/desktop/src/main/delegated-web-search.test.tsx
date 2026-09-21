import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test, vi } from "vitest";
import { createAssistantMessageEventStream } from "@nyte-ai/ai";
import { createNyte } from "@nyte-ai/core";
import type { Nyte, SessionId, StreamFn } from "@nyte-ai/core";
import { SqliteStore } from "@nyte-ai/core/store";
import { inlinePlugin } from "@nyte-ai/plugin";
import { webSearchPlugin, webSearchProviderPlugin } from "@nyte-ai/plugin/examples/web-search";
import type { Api, AssistantMessage, Model } from "@nyte-ai/schema";
import {
  MutationObserver,
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import type { NyteBridge } from "../shared/ipc.ts";
import { keys } from "../renderer/src/query-keys.ts";
import { Selections } from "../renderer/src/conversation/selection.tsx";
import {
  childSelectionOptions,
  parkedSelections,
  selectionReplyOptions,
} from "../renderer/src/conversation/selection.ts";

interface RendererFixture {
  sessions: Nyte["sessions"] | undefined;
}

const bridge = vi.hoisted(() => {
  const state: RendererFixture = { sessions: undefined };
  vi.stubGlobal("window", {
    nyte: {
      sessions: {
        list: (input: Parameters<Nyte["sessions"]["list"]>[0]) => state.sessions?.list(input),
        snapshot: (input: Parameters<Nyte["sessions"]["snapshot"]>[0]) =>
          state.sessions?.snapshot(input),
      },
    },
  });
  return state;
});
afterAll(() => vi.unstubAllGlobals());

const model: Model<Api> = {
  id: "script",
  name: "Script",
  provider: "fixture",
  api: "openai-responses",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1_000,
};

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "nyte-desktop-search-"));
  const store = new SqliteStore(join(directory, "sessions.db"));
  const searched: string[] = [];
  const streamFn: StreamFn = (_model, context) => {
    const last = context.messages.at(-1);
    const content: AssistantMessage["content"] =
      last?.role !== "user"
        ? [{ type: "text", text: "done" }]
        : context.tools?.some((tool) => tool.name === "task")
          ? [
              {
                type: "toolCall",
                id: "task",
                name: "task",
                arguments: { model: "fixture/script", prompt: "Search current releases" },
              },
            ]
          : [
              {
                type: "toolCall",
                id: "search",
                name: "websearch",
                arguments: { query: "current releases" },
              },
            ];
    const reason = content.some((part) => part.type === "toolCall") ? "toolUse" : "stop";
    const message: AssistantMessage = {
      role: "assistant",
      content,
      api: model.api,
      provider: model.provider,
      model: model.id,
      stopReason: reason,
      timestamp: Date.now(),
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => stream.push({ type: "done", reason, message }));
    return stream;
  };
  const sdk = await createNyte({
    store,
    model,
    drain: "all",
    streamFn,
    env: { cwd: directory },
    models: { getModels: () => [model], getAvailable: async () => [model], getModel: () => model },
    plugins: [
      inlinePlugin(
        webSearchPlugin({
          credentials: { read: async () => undefined, write: async () => {} },
          environment: () => undefined,
        }),
      ),
      inlinePlugin(
        webSearchProviderPlugin({
          id: "local-search",
          name: "Local search",
          keyEnvironment: "FIXTURE_SEARCH_KEY",
          async execute(input) {
            searched.push(input.query);
            return [{ title: "Release", url: "https://example.test/release", time: {} }];
          },
        }),
      ),
    ],
  });
  sdk.attach();
  bridge.sessions = sdk.sessions;
  return {
    sdk,
    searched,
    async close() {
      bridge.sessions = undefined;
      await sdk.close();
      await store.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

async function renderParent(client: QueryClient, sdk: Nyte, parent: SessionId) {
  const snapshot = await sdk.sessions.snapshot({ sessionId: parent });
  assert.ok(snapshot);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <Selections sessionId={parent} parked={snapshot.parked} disabled={false} />
    </QueryClientProvider>,
  );
}

function assertChoices(html: string, labels: readonly string[], disabled: boolean) {
  const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
  for (const label of labels) {
    const button = buttons.find((match) => match[1]?.includes(`aria-label="${label}"`));
    assert.ok(button, `Missing consent button: ${label}`);
    assert.ok(button[2]?.replace(/<[^>]*>/g, "").includes(label));
    const description = button[1]?.match(/aria-describedby="([^"]+)"/)?.[1];
    assert.ok(description, `Missing description for ${label}`);
    assert.ok(html.includes(`id="${description}"`), `Missing description target for ${label}`);
    assert.equal(/\sdisabled(?:\s|=|$)/.test(button[1] ?? ""), disabled, label);
  }
}

test.each(["auto", "local-search", "off"])(
  "a parent waiting on task can answer child search with %s, including after renderer restore",
  async (choice) => {
    const f = await fixture();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const replies: Parameters<NyteBridge["runs"]["reply"]>[0][] = [];
    try {
      const parent = (await f.sdk.sessions.create()).sessionId;
      const unrelated = (await f.sdk.sessions.create()).sessionId;
      const options = childSelectionOptions(parent, f.sdk.sessions);
      assert.deepEqual(await client.fetchQuery(options), []);
      const observer = new QueryObserver(client, { ...options, refetchInterval: 10 });
      const unsubscribe = observer.subscribe(() => {});
      try {
        await f.sdk.messages.send({ sessionId: parent, content: "Delegate a search" });
        await expect
          .poll(() => observer.getCurrentResult().data?.flatMap((child) => child.calls).length)
          .toBe(1);
      } finally {
        unsubscribe();
      }
      const waiting = await f.sdk.sessions.snapshot({ sessionId: parent });
      assert.ok(waiting);
      assert.ok(waiting.parked?.some((call) => call.tool === "task"));
      assert.deepEqual(parkedSelections(waiting.parked), []);
      assert.deepEqual(f.searched, []);
      assert.deepEqual(
        await client.fetchQuery(childSelectionOptions(unrelated, f.sdk.sessions)),
        [],
      );

      // A fresh renderer has no task progress, event replay, or pre-seeded child snapshots.
      client.clear();
      const restored = await client.fetchQuery(options);
      const child = restored[0];
      const call = child?.calls[0];
      assert.ok(child && call);
      const html = await renderParent(client, f.sdk, parent);
      assert.match(html, /Asked by fixture\/script/);
      assert.match(html, /current releases/);
      const labels = ["Allow automatic search", "Use Local search", "Off"];
      assertChoices(html, labels, false);

      await assert.rejects(
        client.fetchQuery({
          ...childSelectionOptions(parent, {
            ...f.sdk.sessions,
            snapshot: async () => {
              throw new Error("Child snapshot unavailable");
            },
          }),
          staleTime: 0,
        }),
      );
      const stale = await renderParent(client, f.sdk, parent);
      assert.match(stale, /load delegated sessions/);
      assertChoices(stale, labels, true);
      await client.fetchQuery({ ...options, staleTime: 0 });
      assertChoices(await renderParent(client, f.sdk, parent), labels, false);

      const reply = new MutationObserver(
        client,
        selectionReplyOptions({
          sessionId: child.sessionId,
          call,
          reply: async (input) => {
            replies.push(input);
            return f.sdk.runs.reply(input);
          },
          refresh: async () => {
            await client.invalidateQueries({ queryKey: keys.children(parent), exact: true });
            await client.fetchQuery(options);
          },
        }),
      );
      const selectionReply = { choices: [choice] };
      assert.deepEqual(await reply.mutate(selectionReply), { kind: "signalled" });
      assert.deepEqual(replies, [
        {
          sessionId: child.sessionId,
          runId: call.runId,
          callId: call.callId,
          waitId: call.waitId,
          reply: selectionReply,
        },
      ]);
      await expect
        .poll(async () => (await f.sdk.runs.wait({ sessionId: parent })).kind)
        .toBe("idle");
      assert.deepEqual(f.searched, choice === "off" ? [] : ["current releases"]);
      await client.invalidateQueries({ queryKey: keys.children(parent), exact: true });
      await client.fetchQuery(options);
      assert.doesNotMatch(await renderParent(client, f.sdk, parent), /Allow anonymous web search/);
      client.clear();
      await client.fetchQuery(options);
      assert.doesNotMatch(await renderParent(client, f.sdk, parent), /Allow anonymous web search/);

      const completed = await f.sdk.sessions.snapshot({ sessionId: child.sessionId });
      const result = completed?.transcript
        .flatMap((turn) => (turn.kind === "turn" ? turn.parts : []))
        .find((part) => part.kind === "tool" && part.class.kind === "custom");
      assert.ok(result?.kind === "tool" && result.result);
      assert.deepEqual(result.class, { kind: "custom", label: "websearch" });
      if (choice !== "off") assert.equal(result.result.isError, false);
    } finally {
      client.clear();
      await f.close();
    }
  },
);
