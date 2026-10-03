/**
 * Unit tests for the OAuth callback pages: the provider is named, caller
 * content is escaped, details show up when given, and the page is
 * self-contained (no scripts, no external fetches).
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { oauthErrorHtml, oauthSuccessHtml } from "../src/auth/oauth/oauth-page.ts";

function extractTitle(html: string): string {
  return /<title[^>]*>([^<]*)<\/title>/.exec(html)?.[1] ?? "";
}

function extractHeading(html: string): string {
  return /<h1[^>]*>([^<]*)<\/h1>/.exec(html)?.[1] ?? "";
}

test("the success page names the provider in the tab title and heading, escaped", () => {
  const html = oauthSuccessHtml({ provider: "<img onerror=x>" });
  assert.ok(!html.includes("<img"));
  assert.ok(extractTitle(html).includes("&lt;img onerror=x&gt;"));
  assert.ok(extractHeading(html).includes("&lt;img onerror=x&gt;"));
});

test("the error page renders the message and details escaped", () => {
  const html = oauthErrorHtml(
    "The callback's state did not match <this> attempt.",
    'Error: <b>"denied"</b>',
  );
  assert.ok(html.includes("The callback&#39;s state did not match &lt;this&gt; attempt."));
  assert.ok(!html.includes("<this>"));
  assert.ok(html.includes("Error: &lt;b&gt;&quot;denied&quot;&lt;/b&gt;"));
  assert.ok(!html.includes("<b>"));
});

test("callback pages have no scripts and fetch nothing", () => {
  for (const html of [
    oauthSuccessHtml({ provider: "OpenAI" }),
    oauthErrorHtml("message", "details"),
  ]) {
    assert.ok(!/<script\b/i.test(html));
    assert.ok(!/\b(?:src|href)\s*=\s*["']?\s*(?:https?:)?\/\//i.test(html));
    assert.ok(!/url\(/i.test(html));
    assert.ok(!/@import\b/i.test(html));
  }
});
