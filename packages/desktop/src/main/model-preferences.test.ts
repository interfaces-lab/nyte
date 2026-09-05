import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "vitest";
import {
  applyPreferenceChange,
  EMPTY_MODEL_PREFERENCES,
  ModelPreferencesStore,
  parseModelPreferences,
} from "./model-preferences.ts";

describe("model preferences", () => {
  test("a damaged or partial file reads as empty or fills in defaults", () => {
    assert.deepEqual(parseModelPreferences("not json"), EMPTY_MODEL_PREFERENCES);
    assert.deepEqual(parseModelPreferences('{"providers": 3}'), EMPTY_MODEL_PREFERENCES);
    assert.deepEqual(parseModelPreferences('{"providers": {"openai": {"enabled": false}}}'), {
      providers: { openai: { enabled: false } },
      defaults: {},
    });
  });

  test("changes replace only what they name", () => {
    let preferences = applyPreferenceChange(EMPTY_MODEL_PREFERENCES, {
      kind: "models",
      provider: "openai",
      ids: ["gpt-4", "o1"],
      hidden: true,
    });
    preferences = applyPreferenceChange(preferences, {
      kind: "models",
      provider: "openai",
      ids: ["o1"],
      hidden: false,
    });
    preferences = applyPreferenceChange(preferences, {
      kind: "provider",
      provider: "openai",
      enabled: false,
    });
    preferences = applyPreferenceChange(preferences, { kind: "defaults", thinkingLevel: "high" });
    preferences = applyPreferenceChange(preferences, {
      kind: "defaults",
      model: { provider: "anthropic", id: "claude" },
    });
    assert.deepEqual(preferences, {
      providers: { openai: { enabled: false, hiddenModels: ["gpt-4"] } },
      defaults: { model: { provider: "anthropic", id: "claude" }, thinkingLevel: "high" },
    });
  });

  let directory: string | undefined;
  afterEach(async () => {
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  });

  test("the store round-trips through disk and serializes writes", async () => {
    directory = await mkdtemp(join(tmpdir(), "nyte-preferences-"));
    const path = join(directory, "model-preferences.json");
    const store = new ModelPreferencesStore(path);
    assert.deepEqual(await store.read(), EMPTY_MODEL_PREFERENCES);
    await Promise.all([
      store.update({ kind: "provider", provider: "openai", enabled: false }),
      store.update({ kind: "provider", provider: "anthropic", enabled: false }),
    ]);
    const onDisk = parseModelPreferences(await readFile(path, "utf8"));
    assert.deepEqual(onDisk.providers, {
      openai: { enabled: false },
      anthropic: { enabled: false },
    });
  });
});
