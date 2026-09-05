import assert from "node:assert/strict";
import { test } from "vitest";
import type { DesktopCatalog } from "../../shared/ipc.ts";
import { projectPreference } from "./preference-projection.ts";

const catalog: DesktopCatalog = {
  providers: [
    { id: "provider", name: "Provider", enabled: true, connection: { kind: "oauth" }, signIn: [] },
  ],
  models: ["one", "two"].map((id) => ({
    key: id,
    provider: "provider",
    id,
    name: id,
    contextWindow: 1000,
    cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
    fastMode: { kind: "unavailable" },
    thinkingLevels: ["off", "high"],
    hidden: false,
    listed: true,
  })),
  defaults: { model: { provider: "provider", id: "one" }, thinkingLevel: "off" },
};

test("preference projection updates defaults without altering the host catalog", () => {
  const changed = projectPreference(catalog, { kind: "defaults", thinkingLevel: "high" });
  assert.equal(changed.defaults.thinkingLevel, "high");
  assert.deepEqual(changed.defaults.model, catalog.defaults.model);
  assert.equal(catalog.defaults.thinkingLevel, "off");
});

test("bulk model visibility and provider toggles update listed models immediately", () => {
  const hidden = projectPreference(catalog, {
    kind: "models",
    provider: "provider",
    ids: ["one", "two"],
    hidden: true,
  });
  assert.ok(hidden.models.every((model) => model.hidden && !model.listed));
  const off = projectPreference(catalog, {
    kind: "provider",
    provider: "provider",
    enabled: false,
  });
  assert.equal(off.providers[0]?.enabled, false);
  assert.ok(off.models.every((model) => !model.hidden && !model.listed));
  assert.ok(catalog.models.every((model) => model.listed));
});

test("enabling an unauthenticated provider never pretends it is connected", () => {
  const disconnected: DesktopCatalog = {
    ...catalog,
    providers: catalog.providers.map((provider) => ({
      ...provider,
      enabled: false,
      connection: { kind: "disconnected" },
    })),
  };
  const changed = projectPreference(disconnected, {
    kind: "provider",
    provider: "provider",
    enabled: true,
  });
  assert.ok(changed.models.every((model) => !model.listed));
  assert.equal(changed.providers[0]?.connection.kind, "disconnected");
});
