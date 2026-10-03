import assert from "node:assert/strict";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, test } from "vitest";
import type { GitHubProviderState, HostState, NyteBridge } from "../bridge.ts";
import { installBridge } from "../nyte.ts";
import { keys } from "../query-keys.ts";
import { createWebBridge } from "../web/bridge.ts";
import { AccountsSettings } from "./accounts-settings.tsx";
import { settingsSectionGroups } from "./settings-navigation.tsx";

const web = createWebBridge().bridge;

const pendingGitHub = (): Promise<never> => new Promise<never>(() => undefined);

const withEnvironment: NyteBridge = {
  ...web,
  environment: true,
  host: {
    ...web.host,
    github: {
      state: pendingGitHub,
      signIn: pendingGitHub,
      signOut: pendingGitHub,
      createPullRequest: pendingGitHub,
    },
  },
};

installBridge(withEnvironment);

const clients = new Set<QueryClient>();

afterEach(() => {
  for (const client of clients) client.clear();
  clients.clear();
  installBridge(withEnvironment);
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

  installBridge(web);
  assert.equal(settingsSectionGroups().flat().includes("accounts"), false);
});
