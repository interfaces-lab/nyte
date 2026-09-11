import assert from "node:assert/strict";
import { afterAll, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { sessionId } from "@nyte-ai/protocol";
import type { SettingInfo } from "@nyte-ai/core";
import { PluginSettings } from "./customize.tsx";

vi.hoisted(() => vi.stubGlobal("window", { nyte: {} }));
afterAll(() => vi.unstubAllGlobals());

function render(element: ReactElement) {
  const client = new QueryClient();
  try {
    return renderToStaticMarkup(
      <QueryClientProvider client={client}>{element}</QueryClientProvider>,
    );
  } finally {
    client.clear();
  }
}

const setting: SettingInfo = {
  id: "a-plugin-setting",
  owner: "some-plugin",
  label: "A setting",
  current: "auto",
  choices: [
    { id: "auto", label: "Auto", status: "Auto · Exa · saved key" },
    { id: "on", label: "On", status: "Enabled status" },
    { id: "off", label: "Off" },
  ],
};

test("settings render the current choice status for any plugin", () => {
  const html = render(<PluginSettings sessionId={sessionId("chat")} settings={[setting]} />);
  assert.match(html, /Auto · Exa · saved key/);
  assert.doesNotMatch(html, /Enabled status/);

  const changed = render(
    <PluginSettings sessionId={sessionId("chat")} settings={[{ ...setting, current: "on" }]} />,
  );
  assert.match(changed, /Enabled status/);
  assert.doesNotMatch(changed, /Auto · Exa · saved key/);
});

test("settings show routing details without requiring a footer badge", () => {
  const search: SettingInfo = {
    id: "websearch-provider",
    owner: "web-search",
    label: "Web search",
    current: "auto",
    choices: [
      { id: "auto", label: "automatic", description: "Last search: Auto · Exa · saved key" },
    ],
  };
  const html = render(<PluginSettings sessionId={sessionId("chat")} settings={[search]} />);
  assert.match(html, /Last search: Auto · Exa · saved key/);
});

test("a choice without status shows no stale detail", () => {
  const html = render(
    <PluginSettings sessionId={sessionId("chat")} settings={[{ ...setting, current: "off" }]} />,
  );
  assert.doesNotMatch(html, /Auto · Exa · saved key|Enabled status/);
  assert.match(html, /some-plugin/);
  assert.match(html, /Off/);
});
