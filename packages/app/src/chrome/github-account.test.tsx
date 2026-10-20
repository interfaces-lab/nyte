import assert from "node:assert/strict";
import { asId } from "@nyte-ai/schema";
import { setImmediate } from "node:timers/promises";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, test, vi } from "vitest";
import { SdkError } from "@nyte-ai/sdk";
import type { GitHubAccountApi, GitHubAccountState, GitHubApi, GitHubState } from "@nyte-ai/sdk";
import type { HostState } from "../bridge.ts";
import { keys } from "../query-keys.ts";
import { installConnection } from "../sdk.tsx";
import { scriptedConnection } from "../../test/scripted-connection.ts";
import { useGitHubAccount, useGitHubState } from "./github-account.ts";

const account = {
  account: vi.fn<GitHubAccountApi["account"]>(),
  signIn: vi.fn<GitHubAccountApi["signIn"]>(),
  signOut: vi.fn<GitHubAccountApi["signOut"]>(),
};

installConnection(
  scriptedConnection({
    github: {
      account: () => account.account(),
      signIn: () => account.signIn(),
      signOut: () => account.signOut(),
    },
  }).connection,
);

const folder = { state: vi.fn<GitHubApi["state"]>(), createPullRequest: vi.fn() };

const clients = new Set<QueryClient>();

const signedOut = { kind: "signed_out" } satisfies GitHubAccountState;

const ready = {
  kind: "ready",
  account: { login: "octocat", name: undefined, avatarUrl: undefined },
} satisfies GitHubAccountState;

function repository(name: string): GitHubState {
  return {
    repository: {
      owner: "octocat",
      name,
      remoteName: "origin",
      url: `https://github.com/octocat/${name}`,
    },
    pullRequest: { kind: "none" },
  };
}

function selectWorkspace(client: QueryClient, path: string | null): void {
  client.setQueryData(keys.host, {
    workspace: path === null ? undefined : { id: asId<"workspace">(path), path, name: path },
  } satisfies HostState);
}

function fixture(path: string | null = "/projects/one") {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });

  clients.add(client);
  selectWorkspace(client, path);

  return client;
}

function probe(client: QueryClient) {
  let found: ReturnType<typeof useGitHubAccount> | undefined;
  let repo: ReturnType<typeof useGitHubState> | undefined;

  function Probe() {
    // oxlint-disable-next-line react/globals
    found = useGitHubAccount();
    // oxlint-disable-next-line react/globals
    repo = useGitHubState(folder);

    return null;
  }

  renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>,
  );
  assert.ok(found && repo);

  return { ...found, folder: repo };
}

beforeEach(() => vi.resetAllMocks());

afterEach(() => {
  for (const client of clients) client.clear();
  clients.clear();
});

test("a fetched login error remains available to render and a refresh recovers", async () => {
  const client = fixture();
  const initial = probe(client);
  assert.equal(initial.query.data, undefined);

  const failure = {
    kind: "error",
    message: "GitHub API rate limit exceeded",
  } satisfies GitHubAccountState;

  account.account.mockResolvedValueOnce(failure).mockResolvedValueOnce(signedOut);

  await initial.query.refetch();
  const failed = probe(client);
  assert.deepEqual(failed.query.data, failure);
  assert.equal(failed.query.isError, false);

  await failed.query.refetch();
  assert.deepEqual(probe(client).query.data, signedOut);
});

test("a host that serves no GitHub login reads as none", async () => {
  const client = fixture();
  account.account.mockRejectedValueOnce(new SdkError("unavailable", "No gh here."));
  await probe(client).query.refetch();

  assert.equal(probe(client).query.data, null);
});

test("the login is the machine's, one for every folder, while each folder keeps its repository", async () => {
  const client = fixture();
  account.account.mockResolvedValueOnce(ready);
  await probe(client).query.refetch();

  for (const path of ["/projects/one", "/projects/two"]) {
    selectWorkspace(client, path);
    const current = probe(client);
    assert.deepEqual(current.query.data, ready);
    folder.state.mockResolvedValueOnce(repository(path.slice(-3)));
    await current.folder.refetch();
  }

  for (const path of ["/projects/one", "/projects/two"]) {
    selectWorkspace(client, path);
    assert.deepEqual(probe(client).folder.data, repository(path.slice(-3)));
  }

  assert.equal(account.account.mock.calls.length, 1);
});

test.each(["signIn", "signOut"] as const)(
  "%s is visible to other observers across folder switches, but not other clients",
  async (operation) => {
    const client = fixture();
    const otherClient = fixture();
    const pending = Promise.withResolvers<GitHubAccountState>();
    account[operation].mockReturnValueOnce(pending.promise);
    const mutation = probe(client).auth.mutateAsync(operation);

    for (const path of ["/projects/one", "/projects/two", null]) {
      selectWorkspace(client, path);
      const observer = probe(client);
      assert.equal(observer.busy, true);
      assert.equal(observer.connecting, operation === "signIn");
    }

    assert.equal(probe(otherClient).busy, false);

    pending.resolve(signedOut);
    await mutation;
    assert.equal(probe(client).busy, false);
    assert.equal(probe(client).connecting, false);
  },
);

test("sign-in and sign-out from different observers never change the login concurrently", async () => {
  const client = fixture();
  const signingIn = Promise.withResolvers<GitHubAccountState>();
  const signingOut = Promise.withResolvers<GitHubAccountState>();
  account.signIn.mockReturnValueOnce(signingIn.promise);
  account.signOut.mockReturnValueOnce(signingOut.promise);
  const signIn = probe(client).auth.mutateAsync("signIn");
  await vi.waitFor(() => assert.equal(account.signIn.mock.calls.length, 1));
  const signOut = probe(client).auth.mutateAsync("signOut");
  await setImmediate();
  assert.equal(account.signOut.mock.calls.length, 0);
  assert.equal(probe(client).connecting, true);

  signingIn.resolve(ready);
  await signIn;
  await vi.waitFor(() => assert.equal(account.signOut.mock.calls.length, 1));
  assert.equal(probe(client).busy, true);

  signingOut.resolve(signedOut);
  await signOut;
  assert.equal(probe(client).busy, false);
});

test("an error from sign-in rejects, clears the busy state, and a retry succeeds", async () => {
  const client = fixture();
  client.setQueryData([...keys.github, "account"], signedOut);
  const found = probe(client);

  account.signIn.mockResolvedValueOnce({ kind: "error", message: "GitHub authentication failed" });

  await assert.rejects(found.auth.mutateAsync("signIn"), /GitHub authentication failed/);
  assert.equal(probe(client).busy, false);

  found.auth.reset();
  account.signIn.mockResolvedValueOnce(signedOut);
  assert.deepEqual(await found.auth.mutateAsync("signIn"), signedOut);
});

test("signing out cancels a login read started before it, so the old login never comes back", async () => {
  const client = fixture();
  client.setQueryData([...keys.github, "account"], ready);
  const staleRead = Promise.withResolvers<GitHubAccountState>();
  account.account.mockReturnValueOnce(staleRead.promise).mockResolvedValueOnce(signedOut);
  account.signOut.mockResolvedValueOnce(signedOut);
  const found = probe(client);
  const staleRefresh = found.query.refetch();
  await found.auth.mutateAsync("signOut");
  staleRead.resolve(ready);
  await staleRefresh;
  assert.deepEqual(probe(client).query.data, ready);
  await probe(client).query.refetch();
  assert.deepEqual(probe(client).query.data, signedOut);
});
