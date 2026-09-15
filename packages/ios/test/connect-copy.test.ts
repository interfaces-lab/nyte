import { NyteTransportError, NyteWireError } from "@nyte-ai/client";
import { describe, expect, it } from "vitest";
import {
  classifyConnectFailure,
  connectCopy,
  introCopy,
  SHARE_LOCATION,
  type ConnectStage,
} from "../src/connection/connect-copy.ts";

const ADDRESS = "100.126.254.2:53211";

describe("connectCopy", () => {
  it("gives every stage a next step, so no outcome is a dead end", () => {
    // Keyed by kind, so a stage added without copy fails to compile here too.
    const stages: { [K in ConnectStage["kind"]]: Extract<ConnectStage, { kind: K }> } = {
      idle: { kind: "idle" },
      verifying: { kind: "verifying", address: ADDRESS },
      rejected: {
        kind: "rejected",
        reason: "Enter the full address, including http:// or https://.",
      },
      refused: { kind: "refused" },
      silent: { kind: "silent", address: ADDRESS },
      wrongServer: { kind: "wrongServer", address: ADDRESS },
      notSaved: { kind: "notSaved" },
      unexpected: { kind: "unexpected", detail: "Reply is not valid JSON" },
      cancelled: { kind: "cancelled" },
    };
    for (const stage of Object.values(stages)) {
      const copy = connectCopy(stage);
      expect(copy.title.length, stage.kind).toBeGreaterThan(0);
      expect(copy.body.length, stage.kind).toBeGreaterThan(0);
    }
  });

  it("offers a retry only where the same details could still work", () => {
    expect(connectCopy({ kind: "refused" }).retry).toBeDefined();
    expect(connectCopy({ kind: "silent", address: ADDRESS }).retry).toBeDefined();
    expect(connectCopy({ kind: "cancelled" }).retry).toBeDefined();
    // Retrying an unchanged bad address or a non-Nyte server repeats the same failure.
    expect(connectCopy({ kind: "wrongServer", address: ADDRESS }).retry).toBeUndefined();
    expect(connectCopy({ kind: "rejected", reason: "bad" }).retry).toBeUndefined();
  });

  it("names the address the user typed, so they can compare it with the Mac", () => {
    expect(connectCopy({ kind: "silent", address: ADDRESS }).body).toContain(ADDRESS);
    expect(connectCopy({ kind: "wrongServer", address: ADDRESS }).body).toContain(ADDRESS);
  });

  it("points at the desktop setting that holds the current details", () => {
    expect(connectCopy({ kind: "idle" }).body).toContain(SHARE_LOCATION);
    expect(connectCopy({ kind: "refused" }).body).toContain(SHARE_LOCATION);
    expect(introCopy(true).body).toContain(SHARE_LOCATION);
  });

  it("repeats the policy message when the phone refused the address itself", () => {
    const reason = "Use HTTPS, or HTTP with your Mac's local or Tailscale address.";
    expect(connectCopy({ kind: "rejected", reason }).body).toBe(reason);
  });
});

describe("classifyConnectFailure", () => {
  it("separates a server that refuses from one that never answers", () => {
    expect(
      classifyConnectFailure(
        new NyteWireError({ code: "unauthorized", message: "no" }, 401),
        ADDRESS,
      ),
    ).toEqual({ kind: "refused" });
    expect(classifyConnectFailure(new NyteTransportError({ kind: "network" }), ADDRESS)).toEqual({
      kind: "silent",
      address: ADDRESS,
    });
  });

  it("calls a non-Nyte reply what it is rather than a network problem", () => {
    for (const kind of ["bad_status", "bad_content_type", "bad_body"] as const) {
      expect(classifyConnectFailure(new NyteTransportError({ kind }), ADDRESS)).toEqual({
        kind: "wrongServer",
        address: ADDRESS,
      });
    }
  });

  it("keeps a failed save and an unrecognized ending apart from a Mac that never answered", () => {
    expect(connectCopy({ kind: "notSaved" }).body).not.toContain("Nothing replied");
    expect(connectCopy({ kind: "unexpected", detail: "boom" }).body).toContain("boom");
  });
});
