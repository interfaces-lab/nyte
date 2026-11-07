import { CodeView, EditProvider } from "@pierre/diffs/react";
import type { CodeViewItem } from "@pierre/diffs/react";
import { control, space } from "@nyte-ai/ui/styles/schema.stylex";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { diffStyles } from "../../diff/diff.stylex.ts";
import { PierreWorkerProvider } from "../../lib/pierre-worker-provider.tsx";
import { preferences, useSetting } from "../../preferences/index.ts";
import { diffView } from "../../theme/schema.stylex.ts";
import {
  createEditor,
  editorViewOptions,
  styles as editorStyles,
} from "../../workbench/files/file-editor.tsx";

const PATH = "src/format-bytes.ts";

const CONTENTS = `/** A byte count for the status bar, such as 1.2 MB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return \`\${String(bytes)} B\`;
  const units = ["KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length);
  return \`\${(bytes / 1024 ** exponent).toFixed(1)} \${units[exponent - 1]}\`;
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
    <div {...props(styles.frame(wordWrap ? WRAPPED_LINES : LINES, gitBlame))}>
      <div {...props(editorStyles.root)}>
        <PierreWorkerProvider>
          <EditProvider createEditor={createEditor}>
            <CodeView
              initialItems={ITEMS}
              editorOptions={{ ownsVerticalViewport: true }}
              options={editorViewOptions({ theme, lineNumbers, wordWrap })}
              className={props(diffStyles.patch, editorStyles.code, styles.code).className}
            />
          </EditProvider>
        </PierreWorkerProvider>
        {gitBlame && (
          <div {...props(editorStyles.status)}>
            <span>Line 1</span>
            <span {...props(editorStyles.statusText)}>{BLAME}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** The sample's lines, and with word wrap on, the `exponent` line taking a second. */
const LINES = CONTENTS.split("\n").length;

const WRAPPED_LINES = LINES + 1;

const styles = create({
  frame: (lines: number, status: boolean) => ({
    position: "relative",
    height: `calc(${String(lines)} * ${diffView.lineHeight} + 2 * ${space.s2}${status ? ` + ${control.heightMd}` : ""})`,
  }),
  code: { "--diffs-gap-block": space.s2 },
});
