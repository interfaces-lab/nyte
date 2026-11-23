import { create, props } from "@stylexjs/stylex";
import type { ReactElement, RefObject } from "react";
import type { WorkbenchViewKey } from "../workbench/model.ts";
import { WorkspaceFileEditor } from "./file-editor.tsx";
import type { FileEditorHandle } from "./file-editor.tsx";
import type { FileGroup, FileTab } from "./file-store.ts";

const styles = create({
  filePanel: { position: "absolute", inset: 0, display: "flex", minWidth: 0, minHeight: 0 },
});

/** One file tab's panel and its editor, which registers its handle while mounted. */
export function FileTabPanel({
  viewKey,
  file,
  group,
  editors,
  shown,
  autoSave,
  onGoToLine,
}: {
  readonly viewKey: WorkbenchViewKey;
  readonly file: FileTab;
  readonly group: FileGroup;
  readonly editors: RefObject<Map<string, FileEditorHandle>>;
  readonly shown: boolean;
  readonly autoSave: boolean;
  readonly onGoToLine: () => void;
}): ReactElement {
  return (
    <div
      id={`${viewKey}-file-panel-${file.id}`}
      role="tabpanel"
      aria-labelledby={`${viewKey}-file-tab-${file.id}`}
      hidden={file.id !== group.active?.id}
      {...props(styles.filePanel)}
    >
      <WorkspaceFileEditor
        ref={(editor) => {
          if (editor === null) editors.current.delete(file.id);
          else editors.current.set(file.id, editor);
        }}
        viewKey={viewKey}
        file={file}
        active={shown && file.id === group.active?.id}
        visible={file.id === group.active?.id}
        autoSave={autoSave}
        onGoToLine={onGoToLine}
      />
    </div>
  );
}
