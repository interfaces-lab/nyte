import { CodeView, EditProvider } from "@pierre/diffs/react";
import type { CodeViewItem } from "@pierre/diffs/react";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { diffStyles } from "../../conversation/diff.stylex.ts";
import { PierreWorkerProvider } from "../../pierre-worker-provider.tsx";
import { preferences, useSetting } from "../../preferences/index.ts";
import {
  createEditor,
  editorViewOptions,
  styles as editorStyles,
} from "../../workbench/file-editor.tsx";

const PATH = "packages/app/src/workbench/file-preferences.ts";

const CONTENTS = `import { preferences, useSetting } from "../preferences/index.ts";
/** The options every open file renders with. */
export function useFilePreferences() {
  const lineNumbers = useSetting(preferences.fileLineNumbers);
  const wordWrap = useSetting(preferences.fileWordWrap);
  return { disableLineNumbers: !lineNumbers, overflow: wordWrap ? ("wrap" as const) : ("scroll" as const) };
}`;

const BLAME = `Ada Lovelace · ${new Date(Date.UTC(2026, 0, 12, 9, 30)).toLocaleDateString()} · 4f1c2a9`;

const ITEMS: readonly CodeViewItem<undefined>[] = [
  {
    id: PATH,
    type: "file",
    edit: true,
    file: { name: PATH, contents: CONTENTS, cacheKey: PATH },
  },
];

/**
 * The file editor's `CodeView` and status bar with its options and styles, showing a sample file
 * and blame instead of loading them from the workspace.
 */
export function FileEditorPreview(): ReactElement {
  const theme = useSetting(preferences.theme);
  const lineNumbers = useSetting(preferences.fileLineNumbers);
  const wordWrap = useSetting(preferences.fileWordWrap);
  const gitBlame = useSetting(preferences.fileGitBlame);

  return (
    <div {...props(styles.frame)}>
      <div {...props(editorStyles.root)}>
        <PierreWorkerProvider>
          <EditProvider createEditor={createEditor}>
            <CodeView
              initialItems={ITEMS}
              editorOptions={{ ownsVerticalViewport: true }}
              options={editorViewOptions({ theme, lineNumbers, wordWrap })}
              className={props(diffStyles.patch, editorStyles.code).className}
            />
          </EditProvider>
        </PierreWorkerProvider>
        <div {...props(editorStyles.status)}>
          {gitBlame && (
            <>
              <span>Line 1</span>
              <span {...props(editorStyles.statusText)}>{BLAME}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = create({
  frame: { position: "relative", height: 200 },
});
