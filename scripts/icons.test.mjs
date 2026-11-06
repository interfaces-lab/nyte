import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, test } from "node:test";

import { ICON_CONSUMERS, iconSet } from "./icons.mjs";
/* oxlint-disable nyte-code/no-cross-package-relative-imports -- this test covers the Lucide sets of three packages; none of them is a package export */
import * as uiNames from "../packages/ui/src/icon-names.ts";
import * as uiLucide from "../packages/ui/src/glyphs/lucide.ts";
import * as docsNames from "../packages/docs/src/lib/icon-set/names.ts";
import * as docsLucide from "../packages/docs/src/lib/icon-set/lucide.ts";
import { MOBILE_GLYPH_NAMES } from "../packages/mobile/scripts/icon-set/names.mjs";
import * as mobileLucide from "../packages/mobile/scripts/icon-set/lucide.mjs";
/* oxlint-enable nyte-code/no-cross-package-relative-imports */

const require = createRequire(new URL("../packages/ui/package.json", import.meta.url));

const { createElement } = require("react");

const { renderToStaticMarkup } = require("react-dom/server");

const names = [
  ...uiNames.ICON_NAMES.map((name) => ["ui", name, uiLucide.GLYPHS[name]]),
  ...uiNames.FILLED_ICON_NAMES.map((name) => ["ui filled", name, uiLucide.FILLED_GLYPHS[name]]),
  ...docsNames.DOCS_GLYPH_NAMES.map((name) => ["docs", name, docsLucide.glyphs[name]]),
  ...MOBILE_GLYPH_NAMES.map((name) => ["mobile", name, mobileLucide.glyphs[name]]),
];

void describe(`every icon name has a Lucide glyph (${names.length} names)`, () => {
  for (const [source, name, glyph] of names) {
    void test(`${source}: ${name}`, () => {
      assert.equal(typeof glyph, "function", `${source} "${name}" has no Lucide glyph`);
      const markup = renderToStaticMarkup(createElement(glyph, { size: 16 }));
      assert.match(markup, /^<svg[\s>]/u, `${source} "${name}" didn't render an <svg>`);
      assert.match(markup, /<(path|circle|rect|line|polyline|polygon|ellipse)\b/u);

      const strokedAtCentralWeight =
        !markup.includes("lucide") || markup.includes('stroke-width="1.5"');

      assert.ok(strokedAtCentralWeight, `${source} "${name}" isn't drawn at stroke 1.5`);
    });
  }
});

void describe("each Lucide set maps exactly its names", () => {
  const sets = [
    ["ui", uiNames.ICON_NAMES, uiLucide.GLYPHS],
    ["ui filled", uiNames.FILLED_ICON_NAMES, uiLucide.FILLED_GLYPHS],
    ["docs", docsNames.DOCS_GLYPH_NAMES, docsLucide.glyphs],
    ["mobile", MOBILE_GLYPH_NAMES, mobileLucide.glyphs],
  ];

  for (const [source, expected, set] of sets) {
    void test(source, () => {
      const byName = (a, b) => a.localeCompare(b);
      assert.deepEqual(Object.keys(set).toSorted(byName), expected.slice().toSorted(byName));
    });
  }
});

void describe("icon switch", () => {
  void test("NYTE_ICONS=lucide wins even when Central is installed", () => {
    for (const { name } of ICON_CONSUMERS)
      assert.equal(iconSet(name, { NYTE_ICONS: "lucide" }), "lucide");
  });

  void test("NYTE_ICONS rejects anything but central or lucide", () => {
    assert.throws(() => iconSet("ui", { NYTE_ICONS: "feather" }), /central or lucide/u);
  });

  void test("NYTE_ICONS=central fails loudly without Central installed", (t) => {
    if (iconSet("ui", {}) === "central") {
      t.skip("Central Icons are installed here");

      return;
    }

    assert.throws(() => iconSet("ui", { NYTE_ICONS: "central" }), /CENTRAL_LICENSE_KEY/u);
  });
});
