import { describe, expect, it } from "vitest";
import { WIRE_VERSION, type WorkspaceInfo } from "@nyte-ai/protocol";
import {
  listedWorkspaces,
  selectionMatches,
  workspaceChipLabel,
  workspaceMenuAvailable,
  workspaceSelectCaption,
} from "../src/chat/workspace-menu.ts";

const nyte: WorkspaceInfo = {
  path: "/Users/me/nyte",
  name: "nyte",
  lastOpenedAt: 1,
  available: true,
};
const missing: WorkspaceInfo = {
  path: "/Users/me/gone",
  name: "gone",
  lastOpenedAt: 2,
  available: false,
};
const unknown: WorkspaceInfo = {
  path: "/Users/me/unstated",
  name: "unstated",
  lastOpenedAt: 2,
};
const present: WorkspaceInfo = {
  path: "/Users/me/app",
  name: "app",
  lastOpenedAt: 3,
  available: true,
};

describe("workspaceMenuAvailable", () => {
  it("hides on unspecified hosts", () => {
    expect(
      workspaceMenuAvailable({
        version: "0.0.5",
        wireVersion: WIRE_VERSION,
        host: { kind: "unspecified" },
      }),
    ).toBe(false);
  });

  it("hides when a described host has no workspace tools", () => {
    expect(
      workspaceMenuAvailable({
        version: "0.0.5",
        wireVersion: WIRE_VERSION,
        host: {
          kind: "described",
          capabilities: { workspace: false },
          persistence: "durable",
        },
      }),
    ).toBe(false);
  });

  it("shows when the host describes workspace capability", () => {
    expect(
      workspaceMenuAvailable({
        version: "0.0.5",
        wireVersion: WIRE_VERSION,
        host: {
          kind: "described",
          capabilities: { workspace: true },
          persistence: "durable",
        },
      }),
    ).toBe(true);
  });
});

describe("listedWorkspaces", () => {
  it("keeps only folders the host can open, matching its select refusal", () => {
    expect(listedWorkspaces([nyte, missing, unknown, present]).map((item) => item.path)).toEqual([
      "/Users/me/nyte",
      "/Users/me/app",
    ]);
  });
});

describe("selectionMatches", () => {
  it("matches home against home only", () => {
    expect(selectionMatches({ kind: "home" }, { kind: "home" })).toBe(true);
    expect(selectionMatches({ kind: "project", workspace: nyte }, { kind: "home" })).toBe(false);
  });

  it("matches a project by its listed path", () => {
    const selection = { kind: "project" as const, workspace: nyte };
    expect(selectionMatches(selection, { kind: "project", path: nyte.path })).toBe(true);
    expect(selectionMatches(selection, { kind: "project", path: present.path })).toBe(false);
    expect(selectionMatches({ kind: "home" }, { kind: "project", path: nyte.path })).toBe(false);
  });
});

describe("workspaceChipLabel", () => {
  it("labels Home as Home and a project by its folder name", () => {
    expect(workspaceChipLabel({ kind: "home" })).toBe("Home");
    expect(workspaceChipLabel({ kind: "project", workspace: nyte })).toBe("nyte");
  });
});

describe("workspaceSelectCaption", () => {
  it("has no caption after a successful open", () => {
    expect(workspaceSelectCaption({ kind: "opened", selection: { kind: "home" } })).toBeUndefined();
  });

  it("tells the user to trust an untrusted folder on the Mac", () => {
    expect(workspaceSelectCaption({ kind: "untrusted", path: "/secret" })).toBe(
      "Trust this folder on your Mac, then pick it again.",
    );
  });

  it("says when a listed folder is not on disk", () => {
    expect(workspaceSelectCaption({ kind: "unavailable", path: "/gone" })).toBe(
      "That folder isn't available on your Mac.",
    );
  });

  it("repeats the host failure message", () => {
    expect(workspaceSelectCaption({ kind: "failed", message: "Disk locked." })).toBe(
      "Disk locked.",
    );
  });
});
