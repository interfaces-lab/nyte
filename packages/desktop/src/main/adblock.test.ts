import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { createBlocker, parseFilterLists, shieldPaused } from "./adblock.ts";

const blocker = createBlocker(
  parseFilterLists(
    ["||tracker.example^", "@@||tracker.example/allowed.js", "news.example##.promo"].join("\n"),
  ),
);

describe("filter engine", () => {
  test("blocks matching subresources and leaves the page itself alone", () => {
    const referrer = "https://news.example/";
    assert.deepEqual(
      blocker.decide({ url: "https://tracker.example/t.js", resourceType: "script", referrer }),
      { kind: "block" },
    );
    assert.deepEqual(
      blocker.decide({
        url: "https://tracker.example/allowed.js",
        resourceType: "script",
        referrer,
      }),
      { kind: "allow" },
    );
    assert.deepEqual(
      blocker.decide({ url: "https://cdn.example/app.js", resourceType: "script", referrer }),
      { kind: "allow" },
    );
    assert.deepEqual(
      blocker.decide({ url: "https://tracker.example/", resourceType: "mainFrame", referrer: "" }),
      { kind: "allow" },
    );
  });

  test("hides elements only for the host that names them", () => {
    assert.match(blocker.stylesFor("https://news.example/story"), /\.promo/);
    assert.equal(blocker.stylesFor("https://other.example/"), "");
    assert.equal(blocker.stylesFor("not a url"), "");
  });

  test("a paused host covers its subdomains and nothing else", () => {
    const paused = ["news.example"];
    assert.equal(shieldPaused("https://news.example/story", paused), true);
    assert.equal(shieldPaused("https://m.news.example/", paused), true);
    assert.equal(shieldPaused("https://fakenews.example/", paused), false);
    assert.equal(shieldPaused("https://other.example/", paused), false);
    assert.equal(shieldPaused("not a url", paused), false);
  });
});
