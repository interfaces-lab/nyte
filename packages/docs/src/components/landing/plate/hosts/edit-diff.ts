import { preloadPatchDiff } from "@pierre/diffs/ssr";
import { button, glyph } from "@nyte-ai/ui/schema.stylex";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { cacheLife } from "next/cache";

export const EDIT_STATS = { added: 3, removed: 1 } as const;

const PATCH = `--- a/packages/core/src/kernel/store-schemas.ts
+++ b/packages/core/src/kernel/store-schemas.ts
@@ -84,5 +84,7 @@ export function readRuns(db: Database): Run[] {
   const rows = db
     .prepare("select * from runs order by seq")
     .all();
-  return rows;
+  return rows
+    .filter(isReadableRun)
+    .map(migrateRun);
 }
`;

const SHADOW_CSS = `
:host {
  color-scheme: inherit;
}

[data-line] span {
  font-weight: var(--diffs-token-light-font-weight, inherit);
  font-style: var(--diffs-token-light-font-style, inherit);
  text-decoration: var(--diffs-token-light-text-decoration, inherit);
}
[data-line-type="context"],
[data-gutter-buffer] {
  --diffs-line-bg: var(--diffs-bg);
}

[data-line-type="change-addition"] {
  --diffs-line-bg: var(--diffs-bg-addition);
}

[data-line-type="change-deletion"] {
  --diffs-line-bg: var(--diffs-bg-deletion);
}

[data-column-number][data-line-type="change-addition"]::before,
[data-column-number][data-line-type="change-deletion"]::before {
  content: "";
  contain: strict;
  width: 3px;
  height: 100%;
  display: block;
  position: absolute;
  top: 0;
  left: 0;
  background: var(--diffs-addition-base);
}

[data-column-number][data-line-type="change-deletion"]::before {
  background: var(--diffs-deletion-base);
}

[data-separator="line-info"] {
  height: calc(${button.heightMd} + 16px);
  background-color: transparent;
}

[data-separator-wrapper] {
  width: 100cqi;
  gap: 1px 2px;
  padding: 8px 8px 8px 12px;
  clip-path: inset(0 round ${button.radiusSm}) content-box;
  color: ${role.contentSecondary};
  font-size: ${type.fontSm};
}

[data-content] [data-separator-wrapper] {
  display: none;
}

[data-expand-index] [data-separator-wrapper] {
  grid-template-columns: ${button.heightMd} minmax(0, 1fr);
}

[data-separator-multi-button] {
  grid-template-rows: 1fr 1fr;
}

[data-expand-button],
[data-separator-content],
[data-unmodified-lines] {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  color: inherit;
  text-decoration: none;
}

[data-unmodified-lines] {
  flex: 1;
  align-self: stretch;
  padding-inline: 8px;
  background-color: transparent;
  text-align: start;
}

[data-expand-button] [data-icon] {
  width: ${glyph.sm};
  height: ${glyph.sm};
}
`;

/* Highlighted once at build with the desktop's options, so the page ships no highlighter. */
export async function editDiffHTML(): Promise<string> {
  "use cache";
  cacheLife("max");

  const { prerenderedHTML } = await preloadPatchDiff({
    patch: PATCH,
    options: {
      theme: { light: "github-light", dark: "github-dark" },
      diffStyle: "unified",
      diffIndicators: "classic",
      disableFileHeader: true,
      lineDiffType: "word",
      overflow: "scroll",
      unsafeCSS: SHADOW_CSS,
    },
  });
  return prerenderedHTML;
}
