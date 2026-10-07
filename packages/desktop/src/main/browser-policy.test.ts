import assert from "node:assert/strict";
import { describe, test } from "vitest";
import {
  crashRetryDelay,
  httpsUpgrade,
  isLocalHost,
  permissionAllowed,
  plainRetry,
  uniqueDownloadName,
  webUrl,
} from "./browser-policy.ts";

describe("browser policy", () => {
  test("accepts only web addresses", () => {
    assert.equal(webUrl(" https://example.com/a?b#c "), "https://example.com/a?b#c");
    assert.equal(webUrl("http://localhost:3000"), "http://localhost:3000/");
    assert.equal(webUrl("file:///etc/passwd"), undefined);
    assert.equal(webUrl("javascript:alert(1)"), undefined);
    assert.equal(webUrl("not a url"), undefined);
  });

  test("keeps local and intranet hosts plain", () => {
    assert.equal(isLocalHost("localhost"), true);
    assert.equal(isLocalHost("app.localhost"), true);
    assert.equal(isLocalHost("127.0.0.1"), true);
    assert.equal(isLocalHost("192.168.1.4"), true);
    assert.equal(isLocalHost("172.20.0.1"), true);
    assert.equal(isLocalHost("172.40.0.1"), false);
    assert.equal(isLocalHost("intranet"), true);
    assert.equal(isLocalHost("example.com"), false);
  });

  test("upgrades plain main-frame addresses once per host", () => {
    const plain = new Set<string>();
    assert.equal(httpsUpgrade("http://example.com/x", plain), "https://example.com/x");
    assert.equal(httpsUpgrade("http://example.com:80/x", plain), "https://example.com/x");
    assert.equal(httpsUpgrade("https://example.com/x", plain), undefined);
    assert.equal(httpsUpgrade("http://localhost:5173/", plain), undefined);
    plain.add("example.com");
    assert.equal(httpsUpgrade("http://example.com/x", plain), undefined);
  });

  test("retries plain only after an upgraded load fails for a real reason", () => {
    assert.equal(
      plainRetry("https://example.com/", "http://example.com/", -105),
      "http://example.com/",
    );
    assert.equal(plainRetry("https://example.com/", "http://example.com/", -3), undefined);
    assert.equal(plainRetry("https://example.com/", undefined, -105), undefined);
    assert.equal(plainRetry("http://example.com/", "http://example.com/", -105), undefined);
  });

  test("allows a short permission list", () => {
    assert.equal(permissionAllowed("fullscreen"), true);
    assert.equal(permissionAllowed("clipboard-sanitized-write"), true);
    assert.equal(permissionAllowed("notifications"), false);
    assert.equal(permissionAllowed("geolocation"), false);
    assert.equal(permissionAllowed("openExternal"), false);
  });

  test("numbers a download whose name is taken, keeping the extension", () => {
    const taken = new Set(["report.pdf", "report (1).pdf", "notes"]);
    const exists = (name: string) => taken.has(name);
    assert.equal(uniqueDownloadName("report.pdf", exists), "report (2).pdf");
    assert.equal(uniqueDownloadName("notes", exists), "notes (1)");
    assert.equal(uniqueDownloadName("fresh.zip", exists), "fresh.zip");
    assert.equal(uniqueDownloadName("../etc/passwd", exists), ".._etc_passwd");
    assert.equal(uniqueDownloadName("", exists), "download");
  });

  test("reloads a crashed page with backoff, then gives up for a while", () => {
    const now = 100_000;
    assert.equal(crashRetryDelay([now], now), 250);
    assert.equal(crashRetryDelay([now - 1000, now], now), 500);
    assert.equal(crashRetryDelay([now - 2000, now - 1000, now], now), 1000);
    assert.equal(crashRetryDelay([now - 3000, now - 2000, now - 1000, now], now), undefined);
    assert.equal(crashRetryDelay([now - 60_000, now - 50_000, now - 40_000, now], now), 250);
  });
});
