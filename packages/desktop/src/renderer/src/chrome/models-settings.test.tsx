import assert from "node:assert/strict";
import { afterAll, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import type { DesktopCatalog } from "../../../shared/ipc.ts";
import { keys } from "../query-keys.ts";
import { ModelsSettings } from "./models-settings.tsx";

vi.hoisted(() => vi.stubGlobal("window", { nyte: { host: {} } }));
afterAll(() => vi.unstubAllGlobals());

const catalog: DesktopCatalog = {
  providers: [
    {
      id: "anthropic",
      name: "Anthropic",
      enabled: true,
      connection: { kind: "oauth" },
      signIn: [],
    },
  ],
  models: [
    {
      key: "anthropic/fable",
      provider: "anthropic",
      id: "fable",
      name: "Claude Fable",
      contextWindow: 200_000,
      cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 0 },
      fastMode: { kind: "unavailable" },
      thinkingLevels: ["off", "high"],
      hidden: false,
      listed: true,
    },
  ],
  defaults: { model: { provider: "anthropic", id: "fable" }, thinkingLevel: "high" },
};

test("model settings keep ordinary defaults without a global subagent override", () => {
  const client = new QueryClient();
  client.setQueryData(keys.catalog, catalog);
  try {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <ModelsSettings />
      </QueryClientProvider>,
    );
    assert.match(html, /New chats/);
    assert.match(html, /Default model/);
    assert.match(html, /Default reasoning/);
    assert.doesNotMatch(html, /Subagents|Default subagent model|Inherit from parent/);
    assert.match(html, /Claude Fable · Anthropic/);
  } finally {
    client.clear();
  }
});
