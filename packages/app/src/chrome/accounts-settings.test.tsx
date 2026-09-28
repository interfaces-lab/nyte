import assert from "node:assert/strict";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, test, vi } from "vitest";
import type { GitHubProviderState, HostState } from "../bridge.ts";
import { keys } from "../query-keys.ts";
import { AccountsSettings } from "./accounts-settings.tsx";
import { settingsSectionGroups } from "./settings-navigation.tsx";

const bridge = vi.hoisted(() => ({
  clientSurface: "web",
  environment: true,
  host: { github: { state: () => new Promise<never>(() => undefined) } },
}));

vi.mock("../nyte.ts", () => ({ nyte: bridge }));

const clients = new Set<QueryClient>();

afterEach(() => {
  for (const client of clients) client.clear();
  clients.clear();
  bridge.clientSurface = "web";
  bridge.environment = true;
});

function render(state: GitHubProviderState): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.add(client);
  client.setQueryData(keys.host, {
    platform: "darwin",
    workspace: { path: "/srv/repo", name: "repo", lastOpenedAt: 1 },
  } satisfies HostState);
  client.setQueryData([...keys.github, "/srv/repo"], state);

  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <AccountsSettings />
    </QueryClientProvider>,
  );
}

test("a server's GitHub sign-in shows its device code with a way out", () => {
  const markup = render({
    kind: "signing_in",
    deviceCode: { userCode: "ABCD-1234", verificationUri: "https://github.com/login/device" },
  });

  assert.match(markup, /ABCD-1234/);
  assert.match(markup, /Waiting for approval/);
  assert.match(markup, /Open github\.com/);
  assert.match(markup, />Cancel</);
  assert.doesNotMatch(markup, />Sign in</);
});

test("the web app lists Accounts only when its server has an environment", () => {
  assert.ok(settingsSectionGroups().flat().includes("accounts"));

  bridge.environment = false;
  assert.equal(settingsSectionGroups().flat().includes("accounts"), false);
});
