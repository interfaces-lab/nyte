import assert from "node:assert/strict";
import { test } from "vitest";
import { installBridge } from "../nyte.ts";
import { createWebBridge } from "../web/bridge.ts";
import { showsSettingsSection } from "./pages.ts";

const web = createWebBridge().bridge;

test("only sections this host can show are settings sections", () => {
  installBridge(web);
  assert.ok(showsSettingsSection("general"));
  assert.equal(showsSettingsSection("providers"), false);
  assert.equal(showsSettingsSection("nope"), false);

  installBridge({ ...web, clientSurface: "desktop" });
  assert.ok(showsSettingsSection("providers"));

  installBridge({ ...web, relay: true });
  assert.equal(showsSettingsSection("usage"), false);
  assert.equal(showsSettingsSection("providers"), false);
  assert.equal(showsSettingsSection("profile"), false);
});
