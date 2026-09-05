import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { displayAddress, resolveBrowserAddress } from "./browser-address.ts";

describe("browser address", () => {
  test("takes a full address as written", () => {
    assert.equal(resolveBrowserAddress(" https://example.com/a "), "https://example.com/a");
    assert.equal(resolveBrowserAddress("http://localhost:3000"), "http://localhost:3000/");
  });

  test("prefixes bare hosts, plain for local ones", () => {
    assert.equal(resolveBrowserAddress("example.com"), "https://example.com/");
    assert.equal(
      resolveBrowserAddress("docs.example.com/path?q=1"),
      "https://docs.example.com/path?q=1",
    );
    assert.equal(resolveBrowserAddress("localhost:5173"), "http://localhost:5173/");
    assert.equal(resolveBrowserAddress("127.0.0.1:8080/x"), "http://127.0.0.1:8080/x");
  });

  test("searches everything else and never before Enter", () => {
    assert.equal(
      resolveBrowserAddress("how to center a div"),
      "https://duckduckgo.com/?q=how%20to%20center%20a%20div",
    );
    assert.equal(resolveBrowserAddress("react"), "https://duckduckgo.com/?q=react");
    assert.equal(resolveBrowserAddress("   "), undefined);
  });

  test("hides the https scheme and a lone trailing slash", () => {
    assert.equal(displayAddress("https://example.com/"), "example.com");
    assert.equal(displayAddress("https://example.com/docs/"), "example.com/docs/");
    assert.equal(displayAddress("http://localhost:3000/"), "http://localhost:3000/");
    assert.equal(displayAddress(""), "");
  });
});
