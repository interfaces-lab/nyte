import { describe, expect, it } from "vitest";
import { WIRE_VERSION, type WorkspaceInfo } from "@nyte-ai/protocol";
import {
  applyWorkspaceSelect,
  listedWorkspaces,
  workspaceChipLabel,
  workspaceMenuAvailable,
  workspaceSelectCaption,
} from "../src/chat/workspace-menu.ts";

const nyte: WorkspaceInfo = { path: "/Users/me/nyte", name: "nyte", lastOpenedAt: 1 };
const missing: WorkspaceInfo = {
  path: "/Users/me/gone",
  name: "gone",
  lastOpenedAt: 2,
  available: false,
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
  it("omits folders the host marked unavailable and keeps the rest", () => {
    expect(listedWorkspaces([nyte, missing, present]).map((item) => item.path)).toEqual([
      "/Users/me/nyte",
      "/Users/me/app",
    ]);
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
    expect(
      workspaceSelectCaption({ kind: "opened", selection: { kind: "home" } }),
    ).toBeUndefined();
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

describe("applyWorkspaceSelect", () => {
  const home = {
    kind: "ready" as const,
    items: [nyte],
    selection: { kind: "home" as const },
    switching: { kind: "project" as const, path: nyte.path },
  };

  it("adopts the opened folder and clears the in-flight pick", () => {
    expect(
      applyWorkspaceSelect(home, {
        kind: "opened",
        selection: { kind: "project", workspace: nyte },
      }),
    ).toEqual({
      menu: { kind: "ready", items: [nyte], selection: { kind: "project", workspace: nyte } },
      caption: undefined,
    });
  });

  it("keeps Home when the new folder is untrusted", () => {
    expect(applyWorkspaceSelect(home, { kind: "untrusted", path: nyte.path })).toEqual({
      menu: { kind: "ready", items: [nyte], selection: { kind: "home" } },
      caption: "Trust this folder on your Mac, then pick it again.",
    });
  });
});
