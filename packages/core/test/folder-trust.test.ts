import type { FolderTrust } from "@nyte-ai/schema";
import { assert, expect, it } from "vitest";
import { resourcesPlugin } from "../src/extend/resources.ts";
import { world } from "./fake-env.ts";

it.each<{
  readonly name: string;
  readonly folder: string;
  readonly files?: true;
  readonly setting?: "always" | "never";
  readonly decisions?: readonly (readonly [string, boolean | null])[];
  readonly parentDecision?: true;
  readonly expected: FolderTrust;
}>([
  {
    name: "a new folder with nothing to load says nothing",
    folder: "/t/plain",
    expected: { state: "undecided", notice: null, parent: "/t" },
  },
  {
    name: "a new folder with project files asks",
    folder: "/t/new",
    files: true,
    expected: { state: "undecided", notice: "ask", parent: "/t" },
  },
  {
    name: "workspaceTrust never skips a new folder's project files and says so",
    folder: "/t/new",
    files: true,
    setting: "never",
    expected: { state: "untrusted", by: { kind: "setting" }, notice: "tell", parent: "/t" },
  },
  {
    name: "workspaceTrust never says nothing when there is nothing to skip",
    folder: "/t/plain",
    setting: "never",
    expected: { state: "untrusted", by: { kind: "setting" }, notice: null, parent: "/t" },
  },
  {
    name: "workspaceTrust always loads a new folder",
    folder: "/t/new",
    files: true,
    setting: "always",
    expected: { state: "trusted", by: { kind: "setting" } },
  },
  {
    name: "a folder trusted itself names itself",
    folder: "/t/own",
    files: true,
    setting: "never",
    decisions: [["/t/own", true]],
    expected: { state: "trusted", by: { kind: "folder", path: "/t/own" } },
  },
  {
    name: "a folder an agent made under a trusted parent follows the parent",
    folder: "/t/dev/adk",
    files: true,
    setting: "never",
    decisions: [["/t/dev", true]],
    expected: { state: "trusted", by: { kind: "folder", path: "/t/dev" } },
  },
  {
    name: "the nearest decision wins over a parent's",
    folder: "/t/dev/adk",
    files: true,
    decisions: [
      ["/t/dev", true],
      ["/t/dev/adk", false],
    ],
    expected: {
      state: "untrusted",
      by: { kind: "folder", path: "/t/dev/adk" },
      notice: "tell",
      parent: "/t/dev",
    },
  },
  {
    name: "clearing a folder's decision falls back to its parent",
    folder: "/t/dev/adk",
    files: true,
    decisions: [
      ["/t/dev", true],
      ["/t/dev/adk", false],
      ["/t/dev/adk", null],
    ],
    expected: { state: "trusted", by: { kind: "folder", path: "/t/dev" } },
  },
  {
    name: "the home folder loads as the user's own whatever is decided",
    folder: "/home/me",
    files: true,
    decisions: [["/home/me", false]],
    expected: { state: "home" },
  },
  {
    name: "a decision for the home folder never reaches the folders below it",
    folder: "/home/me/adk",
    files: true,
    decisions: [["/home/me", true]],
    expected: { state: "undecided", notice: "ask", parent: null },
  },
  {
    name: "trusting the parent from the folder covers it without adding the parent",
    folder: "/t/dev/adk",
    files: true,
    setting: "never",
    parentDecision: true,
    expected: { state: "trusted", by: { kind: "folder", path: "/t/dev" } },
  },
  {
    name: "a folder at the root has no parent to offer",
    folder: "/adk",
    files: true,
    expected: { state: "undecided", notice: "ask", parent: null },
  },
])(
  "folder trust: $name",
  async ({ folder, files, setting, decisions = [], parentDecision, expected }) => {
    const { host, disk } = await world({ plugins: [resourcesPlugin], home: "/home/me" });

    const add = async (path: string) => {
      disk.directories.add(path);
      const added = await host.workspaces.add({ kind: "local", path });
      assert(added.kind === "added" || added.kind === "exists");

      return host.workspace(added.workspace);
    };

    if (files === true) disk.put(`${folder}/.nyte/mcp.json`, "{}");

    if (setting !== undefined) {
      expect(await host.settings.apply("workspaceTrust", setting)).toMatchObject({
        kind: "applied",
      });
    }

    for (const [path, trusted] of decisions) {
      expect(await (await add(path)).update({ trusted })).toEqual({ kind: "updated" });
    }

    const handle = await add(folder);

    if (parentDecision === true) {
      expect(await handle.update({ trusted: true, at: "parent" })).toEqual({ kind: "updated" });
    }

    expect((await handle.info()).trust).toEqual(expected);
    expect(
      (await host.workspaces.list()).some(
        (entry) => "path" in entry.target && entry.target.path === "/t/dev",
      ),
    ).toBe(decisions.some(([path]) => path === "/t/dev"));
  },
);
