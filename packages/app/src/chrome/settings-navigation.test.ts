import assert from "node:assert/strict";
import { test } from "vitest";
import { installBridge } from "../nyte.ts";
import { createWebBridge } from "../web/bridge.ts";
import { isSettingsSection } from "./settings-navigation.tsx";

const web = createWebBridge().bridge;

test("only sections this host can show are settings sections", () => {
  installBridge(web);
  assert.ok(isSettingsSection("general"));
  assert.equal(isSettingsSection("providers"), false);
  assert.equal(isSettingsSection("nope"), false);

  installBridge({ ...web, clientSurface: "desktop" });
  assert.ok(isSettingsSection("providers"));

  installBridge({ ...web, environment: true, relay: true });
  assert.ok(isSettingsSection("usage"));
  assert.equal(isSettingsSection("providers"), false);
  assert.equal(isSettingsSection("profile"), false);
});
