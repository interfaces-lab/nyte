import assert from "node:assert/strict";
import { afterAll, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ServerState } from "../../../shared/ipc.ts";
import { keys } from "../query-keys.ts";
import { CloudServerSettings } from "./server-settings.tsx";

vi.hoisted(() => {
  vi.stubGlobal("window", {
    nyte: { host: { setThemePreference: () => undefined } },
    matchMedia: () => ({ matches: false, addEventListener: () => undefined }),
  });
  vi.stubGlobal("self", window);
  vi.stubGlobal("document", {
    head: { appendChild: () => undefined },
    createElement: () => ({ styleSheet: {} }),
    documentElement: { dataset: {}, style: { setProperty: () => undefined } },
  });
});
afterAll(() => vi.unstubAllGlobals());

function render(state: ServerState): string {
  const client = new QueryClient({
    defaultOptions: { queries: { enabled: false, retry: false, staleTime: Infinity } },
  });
  client.setQueryData(keys.server, state);
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <CloudServerSettings active={false} />
    </QueryClientProvider>,
  );
  client.clear();
  return markup;
}

test("a saved but unavailable connection offers recovery without claiming to be connected", () => {
  const markup = render({
    kind: "unavailable",
    baseUrl: "https://nyte.example",
    problem: {
      kind: "network",
      message: "Cannot reach the server. Check your connection and try again.",
    },
  });
  assert.match(markup, /Unavailable/);
  assert.match(markup, /Cannot reach the server/);
  assert.match(markup, /Check connection/);
  assert.match(markup, /Change/);
  assert.doesNotMatch(markup, />Connected</);
});

test("a rejected credential is shown as an access problem", () => {
  const markup = render({
    kind: "unavailable",
    baseUrl: "https://nyte.example",
    problem: {
      kind: "authentication",
      message: "The server rejected this token. Update the connection token.",
    },
  });
  assert.match(markup, /Access required/);
  assert.match(markup, /Update the connection token/);
  assert.doesNotMatch(markup, />Connected</);
});

test("connection success still discloses temporary history storage", () => {
  const markup = render({
    kind: "connected",
    baseUrl: "https://nyte.example",
    info: {
      version: "test",
      wireVersion: 1,
      host: {
        kind: "described",
        capabilities: { workspace: false },
        persistence: "ephemeral",
      },
    },
  });
  assert.match(markup, />Connected</);
  assert.match(markup, /Chat only/);
  assert.match(markup, /Chat history is temporary/);
});
