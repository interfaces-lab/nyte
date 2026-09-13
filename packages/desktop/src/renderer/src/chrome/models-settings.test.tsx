import assert from "node:assert/strict";
import { afterAll, test, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import type { DesktopCatalog, DesktopModelOption } from "../../../shared/ipc.ts";
import { keys } from "../query-keys.ts";
import {
  applyLoginEvent,
  beginLoginAttempt,
  endLoginAttempt,
  setLoginAttemptCancelling,
} from "./login-attempts.ts";
import { ModelsSettings } from "./models-settings.tsx";

vi.hoisted(() => vi.stubGlobal("window", { nyte: { host: {} } }));
afterAll(() => vi.unstubAllGlobals());

const fable: DesktopModelOption = {
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
};

const catalog: DesktopCatalog = {
  source: "local",
  providers: [
    {
      id: "anthropic",
      name: "Anthropic",
      enabled: true,
      connection: { kind: "oauth" },
      signIn: [],
    },
  ],
  models: [fable],
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

const copilot: DesktopCatalog = {
  source: "local",
  providers: [
    {
      id: "github-copilot",
      name: "GitHub Copilot",
      enabled: true,
      connection: { kind: "disconnected" },
      signIn: [{ kind: "browser", label: "Sign in with GitHub", subscription: "Copilot" }],
    },
  ],
  models: [{ ...fable, key: "github-copilot/gpt", provider: "github-copilot", listed: false }],
  defaults: { model: { provider: "github-copilot", id: "gpt" }, thinkingLevel: "high" },
};

function renderSettings(data: DesktopCatalog): string {
  const client = new QueryClient();
  client.setQueryData(keys.catalog, data);
  try {
    return renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <ModelsSettings />
      </QueryClientProvider>,
    );
  } finally {
    client.clear();
  }
}

const deviceCode = {
  kind: "login_progress",
  attempt: "attempt-1",
  provider: "github-copilot",
  progress: {
    kind: "device_code",
    userCode: "ABCD-1234",
    verificationUri: "https://github.com/login/device",
    expiresInSeconds: 900,
    instructions: "GitHub will show OpenCode as the OAuth app.",
  },
} as const;

test("a device code stays on screen with copy, open, and cancel while the flow reports progress", () => {
  beginLoginAttempt({ provider: "github-copilot", attempt: "attempt-1", method: "browser" });
  try {
    assert.match(renderSettings(copilot), /Waiting for the browser/);
    applyLoginEvent(deviceCode);
    const shown = renderSettings(copilot);
    assert.match(shown, /ABCD-1234/);
    assert.match(shown, /https:\/\/github\.com\/login\/device/);
    assert.match(shown, /about 15 min/);
    assert.match(shown, /Copy code/);
    assert.match(shown, /Open github\.com/);
    assert.equal(shown.match(/>Cancel</g)?.length, 1, "one Cancel button, in the row");
    assert.match(shown, /continue signing in/);
    assert.match(shown, /GitHub will show OpenCode as the OAuth app\./);
    assert.doesNotMatch(shown, /approve Nyte/);
    assert.match(shown, /Waiting for approval/);
    assert.doesNotMatch(shown, /Sign in with GitHub/);

    applyLoginEvent({
      kind: "login_progress",
      attempt: "attempt-1",
      provider: "github-copilot",
      progress: { kind: "message", message: "Still waiting for GitHub" },
    });
    const progressed = renderSettings(copilot);
    assert.match(progressed, /ABCD-1234/);
    assert.match(progressed, /GitHub will show OpenCode as the OAuth app\./);
    assert.match(progressed, /Still waiting for GitHub/);

    setLoginAttemptCancelling("github-copilot", "attempt-1", true);
    assert.match(renderSettings(copilot), /Cancelling/);
    // A failed cancel call hands the button back instead of leaving it stuck.
    setLoginAttemptCancelling("github-copilot", "attempt-1", false);
    assert.doesNotMatch(renderSettings(copilot), /Cancelling/);
  } finally {
    endLoginAttempt("github-copilot", "attempt-1");
  }
  const ended = renderSettings(copilot);
  assert.doesNotMatch(ended, /ABCD-1234/);
  assert.match(ended, /Not connected/);
  assert.match(ended, /Sign in with GitHub/);
});

test("progress for a cancelled or unknown attempt never reaches the row", () => {
  applyLoginEvent(deviceCode);
  assert.doesNotMatch(renderSettings(copilot), /ABCD-1234/);

  beginLoginAttempt({ provider: "github-copilot", attempt: "attempt-2", method: "browser" });
  try {
    applyLoginEvent(deviceCode);
    assert.doesNotMatch(renderSettings(copilot), /ABCD-1234/);
    endLoginAttempt("github-copilot", "attempt-1");
    assert.match(renderSettings(copilot), /Waiting for the browser/);
  } finally {
    endLoginAttempt("github-copilot", "attempt-2");
  }
});
