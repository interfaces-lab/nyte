/**
 * Based on https://github.com/earendil-works/pi/blob/a63fb12c135b27aef26a2aa71d8c72f747e96e99/packages/ai/test/node-http-proxy.test.ts
 * Synced with pi a63fb12c1.
 */
import assert from "node:assert/strict";
import { afterEach, describe, test } from "vitest";
import {
  resolveHttpProxyUrlForTarget,
  UNSUPPORTED_PROXY_PROTOCOL_MESSAGE,
} from "../src/utils/node-http-proxy.ts";

const PROXY_ENV_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "all_proxy",
  "npm_config_http_proxy",
  "npm_config_https_proxy",
  "npm_config_proxy",
  "npm_config_no_proxy",
] as const;

const originalEnv = new Map<string, string | undefined>();
for (const key of PROXY_ENV_KEYS) {
  originalEnv.set(key, process.env[key]);
}

function resetProxyEnv(): void {
  for (const key of PROXY_ENV_KEYS) {
    delete process.env[key];
  }
}

afterEach(() => {
  resetProxyEnv();
  for (const [key, value] of originalEnv) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
});

describe("node HTTP proxy resolution", () => {
  test("prefers scoped proxy env aliases before process env aliases", () => {
    resetProxyEnv();
    process.env.https_proxy = "http://process-proxy.example:8080";

    assert.equal(
      resolveHttpProxyUrlForTarget("https://bedrock-runtime.us-east-1.amazonaws.com", {
        HTTPS_PROXY: "http://scoped-proxy.example:8080",
      })?.toString(),
      "http://scoped-proxy.example:8080/",
    );
  });

  test("rejects SOCKS and PAC proxy URLs explicitly", () => {
    resetProxyEnv();
    process.env.HTTPS_PROXY = "socks5://proxy.example:1080";

    assert.throws(
      () => resolveHttpProxyUrlForTarget("https://bedrock-runtime.us-east-1.amazonaws.com"),
      new RegExp(UNSUPPORTED_PROXY_PROTOCOL_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  });

  test("handles subdomain wildcards, IPv6, and ports in NO_PROXY", () => {
    resetProxyEnv();
    process.env.HTTPS_PROXY = "http://proxy.example:8080";
    process.env.NO_PROXY =
      "example.com, .wildcard.org, *.star.net, ::1, [2001:db8::1], 127.0.0.1:8080";

    assert.equal(resolveHttpProxyUrlForTarget("https://example.com"), undefined);
    assert.equal(resolveHttpProxyUrlForTarget("https://api.example.com"), undefined);
    assert.equal(resolveHttpProxyUrlForTarget("https://wildcard.org"), undefined);
    assert.equal(resolveHttpProxyUrlForTarget("https://api.wildcard.org"), undefined);
    assert.equal(resolveHttpProxyUrlForTarget("https://star.net"), undefined);
    assert.equal(resolveHttpProxyUrlForTarget("https://api.star.net"), undefined);
    assert.equal(
      resolveHttpProxyUrlForTarget("https://notexample.com")?.toString(),
      "http://proxy.example:8080/",
    );

    assert.equal(resolveHttpProxyUrlForTarget("https://[::1]:80"), undefined);
    assert.equal(resolveHttpProxyUrlForTarget("https://[2001:db8::1]"), undefined);
    assert.equal(resolveHttpProxyUrlForTarget("https://127.0.0.1:8080"), undefined);
    assert.equal(
      resolveHttpProxyUrlForTarget("https://127.0.0.1:3000")?.toString(),
      "http://proxy.example:8080/",
    );
  });
});
