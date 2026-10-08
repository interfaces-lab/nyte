import assert from "node:assert/strict";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, test } from "vitest";
import type { ConnectView, GitHubProviderState, HostState } from "../bridge.ts";
import { installBridge } from "../nyte.ts";
import { keys } from "../query-keys.ts";
import { createWebBridge } from "../web/bridge.ts";
import { AccountFooterMenu } from "./account-footer.tsx";

installBridge(createWebBridge().bridge);

const pending = (): Promise<never> => new Promise<never>(() => undefined);

const github = { state: pending, signIn: pending, signOut: pending, createPullRequest: pending };

const connect = {
  state: pending,
  link: pending,
  cancel: pending,
  setEnabled: pending,
  unlink: pending,
  revokeDevice: pending,
  openAccount: pending,
  signOut: pending,
};

const clients = new Set<QueryClient>();

afterEach(() => {
  for (const client of clients) client.clear();
  clients.clear();
});

const GITHUB = {
  ready: {
    kind: "ready",
    account: { login: "octocat", name: "The Octocat", avatarUrl: undefined },
    pullRequest: { kind: "none" },
  },
  signedOut: { kind: "signed_out" },
  missing: { kind: "cli_missing" },
} satisfies Record<string, GitHubProviderState>;

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
} satisfies Record<string, ConnectView>;

function render(state: GitHubProviderState, view: ConnectView): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.add(client);
  client.setQueryData(keys.host, {
    platform: "darwin",
    workspace: undefined,
    machineName: "Studio Mac",
  } satisfies HostState);
  client.setQueryData([...keys.github, null], state);
  client.setQueryData(keys.connect, view);

  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <AccountFooterMenu
        github={github}
        connect={connect}
        anchor={{ current: null }}
        onOpenProfile={() => undefined}
      />
    </QueryClientProvider>,
  );
}

test("the footer names the GitHub login, else this Mac, and never the Nyte account", () => {
  for (const view of Object.values(NYTE)) {
    assert.match(render(GITHUB.ready, view), />octocat</);
    assert.match(render(GITHUB.signedOut, view), />Studio Mac</);
    assert.match(render(GITHUB.missing, view), />Studio Mac</);
    assert.doesNotMatch(render(GITHUB.ready, view), /owner@example\.test|The Octocat/);
  }
});
