import assert from "node:assert/strict";
import { asId } from "@nyte-ai/schema";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, test } from "vitest";
import type { GitHubApi, GitHubState } from "@nyte-ai/sdk";
import type { ConnectView, HostState, NyteBridge } from "../bridge.ts";
import { installBridge } from "../nyte.ts";
import { keys } from "../query-keys.ts";
import { createWebBridge } from "../web/bridge.ts";
import { ProfileSettings } from "./profile-settings.tsx";
import { settingsSectionGroups } from "../settings/index.ts";

const web: NyteBridge = { ...createWebBridge().bridge, machineName: "Studio Mac" };

const pending = (): Promise<never> => new Promise<never>(() => undefined);

const github: GitHubApi = {
  state: pending,
  signIn: pending,
  signOut: pending,
  createPullRequest: pending,
};

const desktop: NyteBridge = {
  ...web,
  clientSurface: "desktop",
  host: {
    ...web.host,
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

installBridge(web);

const clients = new Set<QueryClient>();

afterEach(() => {
  for (const client of clients) client.clear();
  clients.clear();
  installBridge(web);
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
} satisfies Record<string, GitHubState>;

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

function render(state: GitHubState, connect: ConnectView | undefined): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.add(client);
  client.setQueryData(keys.host, {
    workspace: { id: asId<"workspace">("repo"), path: "/srv/repo", name: "repo" },
  } satisfies HostState);
  client.setQueryData([...keys.github, "capability", asId<"workspace">("repo")], github);
  client.setQueryData([...keys.github, "/srv/repo"], state);

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
      .map((part) => [part.split('"', 1)[0] ?? "", part]),
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

  const signedOutLinked = groups(render(GITHUB.ready, NYTE.signedOutLinked));
  assert.match(signedOutLinked.get("Nyte account") ?? "", /Sign In…/);
  assert.match(signedOutLinked.get("This Mac") ?? "", /Reachable/, "signing out unlinked the Mac");
  assert.match(signedOutLinked.get("GitHub") ?? "", /octocat/);
  assert.doesNotMatch(signedOutLinked.get("GitHub") ?? "", /The Octocat/);
});

test("Profile is listed on the desktop, which owns its environment, and not in the web app", () => {
  installBridge(desktop);
  assert.ok(settingsSectionGroups().flat().includes("profile"));

  installBridge(web);
  assert.equal(settingsSectionGroups().flat().includes("profile"), false);
});
