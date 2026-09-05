/**
 * The bundled-host adapter embeds both Node-only OAuth flows and registers
 * them before a provider asks its lazy wrapper to load one.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { anthropicOAuth } from "../src/auth/oauth/anthropic.ts";
import {
  loadAnthropicOAuth,
  loadOpenAICodexOAuth,
  registerBundledOAuthFlowLoaders,
} from "../src/auth/oauth/load.ts";
import { openaiCodexOAuth } from "../src/auth/oauth/openai-codex.ts";
import { registerBunOAuthFlows } from "../src/bun-oauth.ts";

test("registerBunOAuthFlows registers the statically embedded flows", async () => {
  registerBundledOAuthFlowLoaders({
    anthropic: () => openaiCodexOAuth,
    openaiCodex: () => anthropicOAuth,
  });
  assert.equal(await loadAnthropicOAuth(), openaiCodexOAuth);
  assert.equal(await loadOpenAICodexOAuth(), anthropicOAuth);

  registerBunOAuthFlows();
  assert.equal(await loadAnthropicOAuth(), anthropicOAuth);
  assert.equal(await loadOpenAICodexOAuth(), openaiCodexOAuth);
});
