import { preloadPatchDiff } from "@pierre/diffs/ssr";
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

/* The shadow rules packages/desktop conversation/diff-view.tsx gives an inline receipt. */
const SHADOW_CSS = `
[data-line-type="context"],
[data-gutter-buffer] {
  --diffs-line-bg: var(--diffs-bg);
}

[data-line-type="change-addition"] {
  --diffs-line-bg: var(--nyte-diff-added-line-bg);
}

[data-line-type="change-deletion"] {
  --diffs-line-bg: var(--nyte-diff-removed-line-bg);
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
      hunkSeparators: "line-info-basic",
      lineDiffType: "word",
      overflow: "scroll",
      unsafeCSS: SHADOW_CSS,
    },
  });
  return prerenderedHTML;
}
