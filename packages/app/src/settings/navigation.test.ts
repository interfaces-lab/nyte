import assert from "node:assert/strict";
import { test } from "vitest";
import type { NyteBridge } from "../contract/bridge.ts";
import { installBridge } from "../contract/nyte.ts";
import { createWebBridge } from "../web/bridge.ts";
import { settingsSectionGroups, showsSettingsSection } from "./pages.ts";

const web = createWebBridge().bridge;

const desktop: NyteBridge = { ...web, clientSurface: "desktop" };

const relay: NyteBridge = { ...web, relay: true };

test.each<{
  readonly name: string;
  readonly bridge: NyteBridge;
  readonly section: string;
  readonly shown: boolean;
}>([
  { name: "the web app shows General", bridge: web, section: "general", shown: true },
  { name: "the web app hides Providers", bridge: web, section: "providers", shown: false },
  { name: "the web app hides Profile", bridge: web, section: "profile", shown: false },
  { name: "an unknown name is not a section", bridge: web, section: "nope", shown: false },
  { name: "the desktop shows Providers", bridge: desktop, section: "providers", shown: true },
  {
    name: "the desktop, which owns its environment, shows Profile",
    bridge: desktop,
    section: "profile",
    shown: true,
  },
  { name: "a relay hides Usage", bridge: relay, section: "usage", shown: false },
  { name: "a relay hides Providers", bridge: relay, section: "providers", shown: false },
  { name: "a relay hides Profile", bridge: relay, section: "profile", shown: false },
])("$name, and the sidebar lists only what it shows", (row) => {
  installBridge(row.bridge);
  assert.equal(showsSettingsSection(row.section), row.shown);
  assert.equal(
    settingsSectionGroups()
      .flat()
      .some((section) => section === row.section),
    row.shown,
  );
});
