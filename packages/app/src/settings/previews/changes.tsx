import { parsePatchFiles } from "@pierre/diffs";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { FileTypeIconSprite } from "@nyte-ai/ui/file-type-icon";
import { preferences, useSetting } from "../../preferences/index.ts";
import { ChangesStack } from "../../workbench/changes/changes-stack.tsx";
import type { ChangesStackItem } from "../../workbench/changes/changes-stack-code-view.ts";
import { patchDigest } from "../../diff/changes-viewed.ts";

const PATH = "src/label.ts";

const HEADER = `diff --git a/${PATH} b/${PATH}
index 9cd6443..1473a06 100644
--- a/${PATH}
+++ b/${PATH}
`;

const PATCH = `${HEADER}@@ -1,4 +1,4 @@
 function label(n: number) {
-    if (n < 2) return "1 file";
+  if (n < 2) return "1 file";
-  return n + " files";
+  return \`\${String(n)} files\`;
 }
`;

const PATCH_IGNORING_WHITESPACE = `${HEADER}@@ -1,4 +1,4 @@
 function label(n: number) {
   if (n < 2) return "1 file";
-  return n + " files";
+  return \`\${String(n)} files\`;
 }
`;

const ITEMS = stackItems(PATCH, 2);

const ITEMS_IGNORING_WHITESPACE = stackItems(PATCH_IGNORING_WHITESPACE, 1);

const NO_PATHS: readonly string[] = [];

export function ChangesPreview(): ReactElement {
  const layout = useSetting(preferences.changesLayout);
  const ignoreWhitespace = useSetting(preferences.changesIgnoreWhitespace);
  const wordWrap = useSetting(preferences.changesWordWrap);

  return (
    <div {...props(styles.frame)}>
      <FileTypeIconSprite />
      <ChangesStack
        items={ignoreWhitespace ? ITEMS_IGNORING_WHITESPACE : ITEMS}
        collapsedPaths={NO_PATHS}
        onToggleCollapsed={() => undefined}
        onExpand={() => undefined}
        scrollTop={0}
        focusPath={undefined}
        focusRevision={0}
        layout={layout}
        wordWrap={wordWrap}
        viewedState={() => "unviewed"}
        onViewedChange={() => undefined}
        onScrollTop={() => undefined}
        onActivePath={() => undefined}
      />
    </div>
  );
}

function stackItems(patch: string, changed: number): readonly ChangesStackItem[] {
  const digest = patchDigest(patch);

  return [
    {
      kind: "diff",
      path: PATH,
      patch,
      digest,
      files: parsePatchFiles(patch, { cacheKeyPrefix: digest }).flatMap((parsed) => parsed.files),
      stat: { kind: "text", added: changed, removed: changed },
    },
  ];
}

const styles = create({
  frame: { display: "flex", height: 172 },
});
