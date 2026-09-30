import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { isSettingsSection } from "./settings-navigation.tsx";

const bridge = vi.hoisted(() => ({ clientSurface: "web", environment: undefined }));

vi.mock("../nyte.ts", () => ({ nyte: bridge }));

afterEach(() => {
  bridge.clientSurface = "web";
});

test("only sections this host can show are settings sections", () => {
  assert.ok(isSettingsSection("general"));
  assert.equal(isSettingsSection("providers"), false);
  assert.equal(isSettingsSection("nope"), false);

  bridge.clientSurface = "desktop";
  assert.ok(isSettingsSection("providers"));
});
