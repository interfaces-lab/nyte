import assert from "node:assert/strict";
import { test } from "vitest";
import { findTailnetAddress, isTailnetIpv4 } from "./tailnet.ts";

const running = JSON.stringify({
  BackendState: "Running",
  TailscaleIPs: ["fd7a:115c:a1e0::a401:fee1", "100.126.254.2"],
  Self: { DNSName: "workmac.tail1234.ts.net." },
});

test("the Tailscale range stops where shared address space does", () => {
  assert.equal(isTailnetIpv4("100.64.0.0"), true);
  assert.equal(isTailnetIpv4("100.126.254.2"), true);
  assert.equal(isTailnetIpv4("100.127.255.255"), true);
  assert.equal(isTailnetIpv4("100.63.255.255"), false);
  assert.equal(isTailnetIpv4("100.128.0.0"), false);
  assert.equal(isTailnetIpv4("192.168.1.1"), false);
  assert.equal(isTailnetIpv4("100.64.0"), false);
  assert.equal(isTailnetIpv4("100.64.0.256"), false);
});

test("a running daemon answers with its IPv4 address and MagicDNS name", async () => {
  const lookup = await findTailnetAddress("darwin", async () => running);
  assert.deepEqual(lookup, {
    kind: "ready",
    // The IPv6 address is listed first and skipped: the listener binds IPv4.
    address: { ip: "100.126.254.2", name: "workmac.tail1234.ts.net" },
  });
});

test("a stopped daemon is unavailable, not missing: its address would fail to bind", async () => {
  const stopped = JSON.stringify({
    BackendState: "Stopped",
    TailscaleIPs: ["100.126.254.2"],
  });
  const lookup = await findTailnetAddress("darwin", async () => stopped);
  assert.deepEqual(lookup, { kind: "unavailable", state: "Stopped" });
});

test("a logged-out daemon with no address is unavailable rather than ready", async () => {
  const lookup = await findTailnetAddress("darwin", async () =>
    JSON.stringify({ BackendState: "Running", TailscaleIPs: [] }),
  );
  assert.deepEqual(lookup, { kind: "unavailable", state: "Running" });
});

test("every candidate path is tried before reporting the CLI missing", async () => {
  const tried: string[] = [];
  const lookup = await findTailnetAddress("darwin", async (executable) => {
    tried.push(executable);
    throw new Error("ENOENT");
  });
  assert.deepEqual(lookup, { kind: "missing" });
  assert.ok(tried.length > 1);
  assert.ok(tried.includes("/usr/local/bin/tailscale"));
});

test("a later path answers when an earlier one is absent", async () => {
  const lookup = await findTailnetAddress("darwin", async (executable) => {
    if (executable !== "/opt/homebrew/bin/tailscale") throw new Error("ENOENT");
    return running;
  });
  assert.equal(lookup.kind, "ready");
});

test("unreadable output is unavailable, never a crash on the share path", async () => {
  const lookup = await findTailnetAddress("darwin", async () => "not json");
  assert.deepEqual(lookup, { kind: "unavailable", state: "Unknown" });
});
