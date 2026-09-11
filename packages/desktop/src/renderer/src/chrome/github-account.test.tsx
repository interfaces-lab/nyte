import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, test, vi } from "vitest";
import type { GitHubProviderState, HostBridge, HostState } from "../../../shared/ipc.ts";
import { keys } from "../query-keys.ts";
import { useGitHubAccount } from "./github-account.ts";

const github = vi.hoisted(() => ({
  state: vi.fn<HostBridge["github"]["state"]>(),
  signIn: vi.fn<HostBridge["github"]["signIn"]>(),
  signOut: vi.fn<HostBridge["github"]["signOut"]>(),
}));

// Electron's preload is absent in Node; React and TanStack run unchanged.
vi.mock("../nyte.ts", () => ({ nyte: { host: { github } } }));

const clients = new Set<QueryClient>();
const signedOut = { kind: "signed_out", repository: undefined } satisfies GitHubProviderState;

function ready(name: string): GitHubProviderState {
  return {
    kind: "ready",
    account: { login: "octocat", name: undefined, avatarUrl: undefined },
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
    platform: "darwin",
    workspace: path === null ? undefined : { path, name: path, lastOpenedAt: 1 },
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

// SSR creates fresh observers, so these probes test cache visibility, not mounted
// effects or preservation of one component's local mutation error across renders.
function probe(client: QueryClient) {
  let account: ReturnType<typeof useGitHubAccount> | undefined;
  function Probe() {
    // SSR has no effects; capture the real hook result for actions after rendering.
    // oxlint-disable-next-line react/globals
    account = useGitHubAccount();
    return null;
  }
  renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>,
  );
  assert.ok(account);
  return account;
}

beforeEach(() => vi.resetAllMocks());
afterEach(() => {
  for (const client of clients) client.clear();
  clients.clear();
});

test("a fetched provider error remains available to render and a refresh recovers", async () => {
  const client = fixture();
  const initial = probe(client);
  assert.equal(initial.query.data, undefined);
  assert.equal(initial.query.isPending, true);
  const failure = {
    kind: "error",
    repository: undefined,
    message: "GitHub API rate limit exceeded",
  } satisfies GitHubProviderState;
  github.state.mockResolvedValueOnce(failure).mockResolvedValueOnce(signedOut);

  await initial.query.refetch();
  const failed = probe(client);
  assert.deepEqual(failed.query.data, failure);
  assert.equal(failed.query.isError, false);
  assert.equal(failed.busy, false);

  await failed.query.refetch();
  const recovered = probe(client);
  assert.deepEqual(recovered.query.data, signedOut);
  assert.equal(recovered.query.error, null);
});

test("a rejected status refresh exposes an error without discarding the last account", async () => {
  const client = fixture();
  const connected = ready("one");
  client.setQueryData([...keys.github, "/projects/one"], connected);
  const failure = new Error("Preload connection closed");
  github.state.mockRejectedValueOnce(failure).mockResolvedValueOnce(signedOut);

  await probe(client).query.refetch();
  const failed = probe(client);
  assert.equal(failed.query.isError, true);
  assert.equal(failed.query.error, failure);
  assert.deepEqual(failed.query.data, connected);

  await failed.query.refetch();
  const recovered = probe(client);
  assert.equal(recovered.query.isError, false);
  assert.deepEqual(recovered.query.data, signedOut);
});

test("Home and each workspace retain their own repository state", async () => {
  const client = fixture(null);
  const targets = [
    { path: null, state: signedOut },
    { path: "/projects/one", state: ready("one") },
    { path: "/projects/two", state: ready("two") },
  ];
  for (const target of targets) {
    selectWorkspace(client, target.path);
    const account = probe(client);
    assert.equal(account.query.data, undefined);
    github.state.mockResolvedValueOnce(target.state);
    await account.query.refetch();
    assert.deepEqual(probe(client).query.data, target.state);
  }
  for (const target of targets) {
    selectWorkspace(client, target.path);
    assert.deepEqual(probe(client).query.data, target.state);
  }
});

test.each(["signIn", "signOut"] as const)(
  "%s is visible to other account observers across workspace switches, but not other clients",
  async (operation) => {
    const client = fixture();
    const otherClient = fixture();
    const pending = Promise.withResolvers<GitHubProviderState>();
    github[operation].mockReturnValueOnce(pending.promise);
    const mutation = probe(client).auth.mutateAsync(operation);

    for (const path of ["/projects/one", "/projects/two", null]) {
      selectWorkspace(client, path);
      const observer = probe(client);
      assert.equal(observer.busy, true);
      assert.equal(observer.connecting, operation === "signIn");
    }
    assert.equal(probe(otherClient).busy, false);
    assert.equal(probe(otherClient).connecting, false);

    pending.resolve(signedOut);
    await mutation;
    assert.equal(probe(client).busy, false);
    assert.equal(probe(client).connecting, false);
  },
);

test("auth operations from different observers cannot change shared credentials concurrently", async () => {
  const client = fixture();
  const signingIn = Promise.withResolvers<GitHubProviderState>();
  const signingOut = Promise.withResolvers<GitHubProviderState>();
  github.signIn.mockReturnValueOnce(signingIn.promise);
  github.signOut.mockReturnValueOnce(signingOut.promise);
  const signIn = probe(client).auth.mutateAsync("signIn");
  await vi.waitFor(() => assert.equal(github.signIn.mock.calls.length, 1));
  const signOut = probe(client).auth.mutateAsync("signOut");
  await setImmediate();
  assert.equal(github.signOut.mock.calls.length, 0);
  assert.equal(probe(client).connecting, true);

  signingIn.resolve(ready("one"));
  await signIn;
  await vi.waitFor(() => assert.equal(github.signOut.mock.calls.length, 1));
  assert.equal(probe(client).busy, true);
  assert.equal(probe(client).connecting, false);

  signingOut.resolve(signedOut);
  await signOut;
  assert.equal(probe(client).busy, false);
});

test("auth finishing after a workspace switch refreshes all targets without caching its old repository", async () => {
  const client = fixture();
  for (const path of ["/projects/one", "/projects/two", null]) {
    selectWorkspace(client, path);
    client.setQueryData([...keys.github, path], signedOut);
    probe(client);
  }
  selectWorkspace(client, "/projects/one");
  const pending = Promise.withResolvers<GitHubProviderState>();
  github.signIn.mockReturnValueOnce(pending.promise);
  const mutation = probe(client).auth.mutateAsync("signIn");
  selectWorkspace(client, "/projects/two");
  pending.resolve(ready("one"));
  await mutation;
  assert.deepEqual(probe(client).query.data, signedOut);

  for (const path of ["/projects/two", "/projects/one", null]) {
    selectWorkspace(client, path);
    const current = ready(path ?? "home");
    github.state.mockResolvedValueOnce(current);
    // SSR has no mounted subscriptions. Only invalidated seeds qualify for this
    // refetch, which runs the hook's actual query function.
    await client.refetchQueries({ queryKey: [...keys.github, path], exact: true, stale: true });
    assert.deepEqual(probe(client).query.data, current);
  }
});

test.each([
  { operation: "signIn", failure: "provider" },
  { operation: "signOut", failure: "provider" },
  { operation: "signIn", failure: "transport" },
  { operation: "signOut", failure: "transport" },
] as const)("$operation recovers after a $failure failure", async ({ operation, failure }) => {
  const client = fixture();
  client.setQueryData([...keys.github, "/projects/one"], signedOut);
  const account = probe(client);
  if (failure === "provider") {
    github[operation].mockResolvedValueOnce({
      kind: "error",
      repository: undefined,
      message: "GitHub authentication failed",
    });
  } else {
    github[operation].mockRejectedValueOnce(new Error("GitHub authentication failed"));
  }

  await assert.rejects(account.auth.mutateAsync(operation), /GitHub authentication failed/);
  assert.equal(probe(client).busy, false);
  assert.equal(probe(client).connecting, false);
  const refreshed = ready("one");
  github.state.mockResolvedValueOnce(refreshed);
  await client.refetchQueries({
    queryKey: [...keys.github, "/projects/one"],
    exact: true,
    stale: true,
  });
  assert.deepEqual(probe(client).query.data, refreshed);

  account.auth.reset();
  github[operation].mockResolvedValueOnce(signedOut);
  assert.deepEqual(await account.auth.mutateAsync(operation), signedOut);
  assert.equal(probe(client).busy, false);
});

test("auth cancels a pre-auth status read before it can replace the cached account", async () => {
  const client = fixture();
  const connected = ready("one");
  client.setQueryData([...keys.github, "/projects/one"], connected);
  const staleRead = Promise.withResolvers<GitHubProviderState>();
  github.state.mockReturnValueOnce(staleRead.promise).mockResolvedValueOnce(signedOut);
  github.signOut.mockResolvedValueOnce(signedOut);
  const account = probe(client);
  const staleRefresh = account.query.refetch();
  await account.auth.mutateAsync("signOut");
  staleRead.resolve(ready("outdated-repository"));
  await staleRefresh;
  assert.deepEqual(probe(client).query.data, connected);
  await probe(client).query.refetch();
  assert.deepEqual(probe(client).query.data, signedOut);
});
