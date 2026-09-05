/**
 * Unit tests for the OAuth callback pages: the provider is named, caller
 * content is escaped, details show up when given, and the page is
 * self-contained (no scripts, no external fetches).
 */
import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { oauthErrorHtml, oauthSuccessHtml } from "../src/auth/oauth/oauth-page.ts";

function extractTitle(html: string): string {
  return /<title[^>]*>([^<]*)<\/title>/.exec(html)?.[1] ?? "";
}

function extractHeading(html: string): string {
  return /<h1[^>]*>([^<]*)<\/h1>/.exec(html)?.[1] ?? "";
}

describe("oauthSuccessHtml", () => {
  test("names the provider in the tab title and the heading", () => {
    const html = oauthSuccessHtml({ provider: "Anthropic" });
    assert.ok(extractTitle(html).includes("Anthropic"));
    assert.ok(extractHeading(html).includes("Anthropic"));
  });

  test("escapes the provider name", () => {
    const html = oauthSuccessHtml({ provider: "<img onerror=x>" });
    assert.ok(!html.includes("<img"));
    assert.ok(html.includes("&lt;img onerror=x&gt;"));
  });
});

describe("oauthErrorHtml", () => {
  test("renders the message escaped", () => {
    const html = oauthErrorHtml("The callback's state did not match <this> attempt.");
    assert.ok(html.includes("The callback&#39;s state did not match &lt;this&gt; attempt."));
    assert.ok(!html.includes("<this>"));
  });

  test("renders details escaped when given", () => {
    const html = oauthErrorHtml("Provider sent back an error.", 'Error: <b>"denied"</b>');
    assert.ok(html.includes("Error: &lt;b&gt;&quot;denied&quot;&lt;/b&gt;"));
    assert.ok(!html.includes("<b>"));
  });
});

describe("callback pages are self-contained", () => {
  for (const [name, html] of [
    ["success", oauthSuccessHtml({ provider: "OpenAI" })],
    ["error", oauthErrorHtml("message", "details")],
  ] as const) {
    test(`${name} page has no scripts and fetches nothing`, () => {
      assert.ok(!/<script\b/i.test(html));
      assert.ok(!/\b(?:src|href)\s*=\s*["']?\s*(?:https?:)?\/\//i.test(html));
      assert.ok(!/url\(/i.test(html));
      assert.ok(!/@import\b/i.test(html));
    });
  }
});
