import assert from "node:assert/strict";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, test } from "vitest";
import type { ConnectView, GitHubProviderState, HostState, NyteBridge } from "../bridge.ts";
import { installBridge } from "../nyte.ts";
import { keys } from "../query-keys.ts";
import { createWebBridge } from "../web/bridge.ts";
import { ProfileSettings } from "./profile-settings.tsx";
import { settingsSectionGroups } from "../settings/index.ts";

const web = createWebBridge().bridge;

const pending = (): Promise<never> => new Promise<never>(() => undefined);

const github = { state: pending, signIn: pending, signOut: pending, createPullRequest: pending };

const withEnvironment: NyteBridge = { ...web, environment: true, host: { ...web.host, github } };

const desktop: NyteBridge = {
  ...web,
  clientSurface: "desktop",
  host: {
    ...web.host,
    github,
    connect: {
      state: pending,
      link: pending,
      cancel: pending,
      setEnabled: pending,
      unlink: pending,
      revokeDevice: pending,
      openAccount: pending,
      signOut: pending,
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

const repository = {
  owner: "octocat",
  name: "repo",
  remoteName: "origin",
  url: "https://github.com/octocat/repo",
};

const GITHUB = {
  ready: {
    kind: "ready",
    account: { login: "octocat", name: "The Octocat", avatarUrl: undefined },
    repository,
    pullRequest: { kind: "none" },
  },
  signedOut: { kind: "signed_out", repository },
  missing: { kind: "cli_missing", repository },
} satisfies Record<string, GitHubProviderState>;

const environment = { id: "env-1", name: "Studio Mac", address: "https://connect.test/r/env-1" };

const NYTE = {
  signedIn: {
    kind: "unlinked",
    account: { kind: "signed_in", label: "owner@example.test" },
    linking: { kind: "idle" },
    notice: { kind: "none" },
  },
  signedOut: {
    kind: "unlinked",
    account: { kind: "signed_out" },
    linking: { kind: "idle" },
    notice: { kind: "none" },
  },
  signedOutLinked: {
    kind: "linked",
    account: { kind: "signed_out" },
    owner: { id: "user_1", label: "owner@example.test" },
    environment,
    enabled: true,
    connection: { kind: "connected" },
    lease: { kind: "current", expiresAt: Date.now() + 60_000 },
    devices: [{ id: "phone-1", name: "iPhone", createdAt: 0, authorized: true }],
  },
} satisfies Record<string, ConnectView>;

function render(github: GitHubProviderState, connect: ConnectView | undefined): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.add(client);
  client.setQueryData(keys.host, {
    platform: "darwin",
    workspace: { path: "/srv/repo", name: "repo", lastOpenedAt: 1 },
    machineName: "Studio Mac",
  } satisfies HostState);
  client.setQueryData([...keys.github, "/srv/repo"], github);

  if (connect !== undefined) client.setQueryData(keys.connect, connect);

  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ProfileSettings onOpenEnvironments={() => undefined} />
    </QueryClientProvider>,
  );
}

/** Each group's markup by its label. */
function groups(markup: string): Map<string, string> {
  return new Map(
    markup
      .split('<section aria-label="')
      .slice(1)
      .map((part) => [part.slice(0, part.indexOf('"')), part]),
  );
}

test("a server's GitHub sign-in shows its device code with a way out", () => {
  const markup = render(
    {
      kind: "signing_in",
      deviceCode: { userCode: "ABCD-1234", verificationUri: "https://github.com/login/device" },
    },
    undefined,
  );

  assert.match(markup, /ABCD-1234/);
  assert.match(markup, /Waiting for approval/);
  assert.match(markup, /github\.com\/login\/device/);
  assert.match(markup, />Cancel</);
  assert.doesNotMatch(markup, /Nyte account/);
});

test("the GitHub CLI, the Nyte account, and this Mac each change only their own group", () => {
  installBridge(desktop);

  for (const view of Object.values(NYTE)) {
    const seen = Object.values(GITHUB).map((state) => groups(render(state, view)));

    for (const label of ["Nyte account", "This Mac"]) {
      assert.equal(new Set(seen.map((group) => group.get(label))).size, 1, label);
    }
  }

  for (const state of Object.values(GITHUB)) {
    const seen = Object.values(NYTE).map((view) => groups(render(state, view)).get("GitHub"));
    assert.equal(new Set(seen).size, 1, state.kind);
  }

  const signedIn = groups(render(GITHUB.signedOut, NYTE.signedIn));
  assert.match(signedIn.get("Nyte account") ?? "", /owner@example\.test/);
  assert.doesNotMatch(signedIn.get("Nyte account") ?? "", /The Octocat|octocat/);

  // Signing out of Nyte leaves the Mac linked and reachable.
  const linked = groups(render(GITHUB.ready, NYTE.signedOutLinked));
  assert.match(linked.get("Nyte account") ?? "", /Sign In…/);
  assert.match(linked.get("This Mac") ?? "", /Reachable/);
  assert.match(linked.get("GitHub") ?? "", /octocat/);
  assert.doesNotMatch(linked.get("GitHub") ?? "", /The Octocat/);
});

test("the web app lists Profile only when its server has an environment", () => {
  assert.ok(settingsSectionGroups().flat().includes("profile"));

  installBridge(web);
  assert.equal(settingsSectionGroups().flat().includes("profile"), false);
});
