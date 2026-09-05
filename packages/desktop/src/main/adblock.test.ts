import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { createBlocker, parseFilterLists } from "./adblock.ts";

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
});
