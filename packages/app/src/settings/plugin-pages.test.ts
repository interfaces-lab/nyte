import assert from "node:assert/strict";
import type { PresetPage } from "@nyte-ai/schema";
import type { HostView, SettingInfo } from "@nyte-ai/sdk";
import { expectTypeOf, test } from "vitest";
import type { NyteBridge } from "../contract/bridge.ts";
import { installBridge } from "../contract/nyte.ts";
import { createWebBridge } from "../web/bridge.ts";
import { placePluginSettings } from "./plugin-pages.ts";
import type { SettingsSection } from "../settings-sections/sections.ts";

type PluginInfo = HostView["plugins"][number];

const web = createWebBridge().bridge;

const desktop: NyteBridge = { ...web, clientSurface: "desktop" };

const plugin = (id: string, source: PluginInfo["source"]): PluginInfo => ({
  id,
  source,
  path: null,
  issues: [],
});

const setting = (owner: string, id: string, extra: Partial<SettingInfo> = {}): SettingInfo => ({
  id,
  owner,
  scope: "host",
  title: id,
  schema: { type: "string" },
  choices: null,
  value: "",
  from: "default",
  ...extra,
});

const PLUGINS = [plugin("shipped", "inline"), plugin("mine", "user"), plugin("theirs", "project")];

test("the pages a plugin can name are exactly this app's settings sections", () => {
  expectTypeOf<PresetPage>().toEqualTypeOf<SettingsSection>();
});

test.each<{
  readonly name: string;
  readonly bridge: NyteBridge;
  readonly settings: readonly SettingInfo[];
  readonly preset: readonly (readonly [string, string, readonly string[]])[];
  readonly custom: readonly (readonly [string, string, readonly string[]])[];
}>([
  {
    name: "no page, from a plugin you installed: under General, one group per plugin",
    bridge: desktop,
    settings: [setting("mine", "a"), setting("theirs", "b"), setting("mine", "c")],
    preset: [
      ["general", "mine", ["a", "c"]],
      ["general", "theirs", ["b"]],
    ],
    custom: [],
  },
  {
    name: "no page, from a plugin the app ships: nowhere, since the app draws those itself",
    bridge: desktop,
    settings: [setting("shipped", "desktop.keepAwake")],
    preset: [],
    custom: [],
  },
  {
    name: "a preset page: on that page, whoever ships the plugin",
    bridge: desktop,
    settings: [
      setting("mine", "accent", { page: "themes" }),
      setting("shipped", "startup", { page: "general" }),
    ],
    preset: [
      ["themes", "mine", ["accent"]],
      ["general", "shipped", ["startup"]],
    ],
    custom: [],
  },
  {
    name: "custom text: a page of its own under that title, shared by every setting naming it",
    bridge: desktop,
    settings: [
      setting("shipped", "web.provider", { page: "Web search" }),
      setting("mine", "mine.engine", { page: "Web search" }),
      setting("mine", "mine.other", { page: "Mine" }),
    ],
    preset: [],
    custom: [
      ["Web search", "shipped", ["web.provider"]],
      ["Web search", "mine", ["mine.engine"]],
      ["Mine", "mine", ["mine.other"]],
    ],
  },
  {
    name: "a preset page this client doesn't show: under General",
    bridge: web,
    settings: [setting("mine", "key", { page: "providers" })],
    preset: [["general", "mine", ["key"]]],
    custom: [],
  },
  {
    name: "a preset name is matched exactly, so another spelling is a page of its own",
    bridge: desktop,
    settings: [setting("mine", "budget", { page: "Usage" })],
    preset: [],
    custom: [["Usage", "mine", ["budget"]]],
  },
  {
    name: "only host settings with a field are placed",
    bridge: desktop,
    settings: [
      setting("mine", "list", { schema: { type: "array" }, page: "usage" }),
      setting("mine", "per-chat", { scope: "chat", page: "Mine" }),
      setting("mine", "menu", { schema: {}, choices: [{ value: 1, title: "One" }] }),
      setting("mine", "secret", { schema: {}, secret: true, value: null }),
      setting("mine", "switch", { schema: { type: "boolean" }, value: false }),
      setting("mine", "number", { schema: { type: "integer" }, value: 0 }),
    ],
    preset: [["general", "mine", ["menu", "secret", "switch", "number"]]],
    custom: [],
  },
])("$name", (row) => {
  installBridge(row.bridge);
  const placed = placePluginSettings(PLUGINS, row.settings);

  const rows = (
    pages: ReadonlyMap<string, readonly { owner: string; settings: readonly SettingInfo[] }[]>,
  ) =>
    [...pages].flatMap(([page, groups]) =>
      groups.map((group) => [page, group.owner, group.settings.map((entry) => entry.id)]),
    );

  assert.deepEqual(rows(placed.preset), row.preset);
  assert.deepEqual(rows(placed.custom), row.custom);
});
