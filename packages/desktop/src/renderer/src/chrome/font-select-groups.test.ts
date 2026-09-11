import assert from "node:assert/strict";
import { describe, test } from "vitest";
import {
  CODE_FONT_CATALOG_TITLE,
  fontSelectGroups,
  selectedFontOption,
  UI_FONT_CATALOG_TITLE,
} from "./font-select-groups.ts";

describe("fontSelectGroups", () => {
  test("keeps built-ins pinned and omits an empty catalog", () => {
    const groups = fontSelectGroups(
      [
        { value: "inter", label: "Inter", fontFamily: "Inter" },
        { value: "system", label: "System UI", fontFamily: "system-ui" },
      ],
      [],
      undefined,
      (family) => `local:${family}`,
      (selection) => selection,
      UI_FONT_CATALOG_TITLE,
    );

    assert.deepEqual(
      groups.map((group) => group.id),
      ["pinned"],
    );
    assert.deepEqual(
      groups[0]?.items.map((option) => option.label),
      ["Inter", "System UI"],
    );
  });

  test("lists installed faces under the catalog title", () => {
    const groups = fontSelectGroups(
      [{ value: "system", label: "System Mono", fontFamily: "ui-monospace" }],
      ["Berkeley Mono", "JetBrains Mono"],
      undefined,
      (family) => `local:${family}`,
      (selection) => selection,
      CODE_FONT_CATALOG_TITLE,
    );

    assert.equal(groups[1]?.title, "Monospace");
    assert.deepEqual(
      groups[1]?.items.map((option) => option.label),
      ["Berkeley Mono", "JetBrains Mono"],
    );
  });

  test("skips installed names that collide with a built-in label", () => {
    const groups = fontSelectGroups(
      [{ value: "inter", label: "Inter", fontFamily: "Inter" }],
      ["Inter", "Arial"],
      undefined,
      (family) => `local:${family}`,
      (selection) => selection,
      UI_FONT_CATALOG_TITLE,
    );

    assert.deepEqual(
      groups[1]?.items.map((option) => option.label),
      ["Arial"],
    );
  });

  test("pins a selected local that the catalog has not listed yet", () => {
    const groups = fontSelectGroups(
      [{ value: "inter", label: "Inter", fontFamily: "Inter" }],
      ["Arial"],
      "Comic Sans MS",
      (family) => `local:${family}`,
      (selection) => selection,
      UI_FONT_CATALOG_TITLE,
    );

    assert.deepEqual(
      groups[0]?.items.map((option) => option.label),
      ["Inter", "Comic Sans MS"],
    );
    assert.deepEqual(
      groups[1]?.items.map((option) => option.label),
      ["Arial"],
    );
    assert.equal(selectedFontOption(groups, "local:Comic Sans MS")?.label, "Comic Sans MS");
  });
});
