import type { Document } from "@nyte-ai/sdk";
import { Button } from "@nyte-ai/ui/button";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuSwitchItem,
  MenuTrigger,
} from "@nyte-ai/ui/menu";
import { create } from "@stylexjs/stylex";
import type { ReactElement, ReactNode, RefObject } from "react";
import { revealLabel } from "../components/context-menu.ts";
import type { SelectedWorkspace } from "../contract/bridge.ts";
import { nyte } from "../contract/nyte.ts";
import { preferences, useSetting } from "../preferences/index.ts";
import type { Preference } from "../preferences/index.ts";
import { workspaceFile } from "../workbench/paths.ts";
import type { FileEditorHandle } from "./file-editor.tsx";
import type { FileTab } from "./file-store.ts";
import { opensUnwrapped } from "./long-line.ts";

const styles = create({
  menu: {
    minWidth: "min(220px, var(--available-width))",
    maxWidth: "min(420px, var(--available-width))",
  },
});

const FILE_TOGGLES = [
  ["Line Numbers", preferences.fileLineNumbers],
  ["Word Wrap", preferences.fileWordWrap],
  ["Git Blame", preferences.fileGitBlame],
  ["Auto Save", preferences.fileAutoSave],
  ["Format on Save", preferences.fileFormatOnSave],
] as const;

function FilePreferenceItem({
  label,
  setting,
  overridden,
}: {
  readonly label: string;
  readonly setting: Preference<boolean>;
  readonly overridden: boolean;
}): ReactElement {
  const checked = useSetting(setting);

  return (
    <MenuSwitchItem
      layout="plain"
      checked={checked && !overridden}
      disabled={overridden}
      onCheckedChange={setting.set}
    >
      {overridden ? `${label} (Line Too Long)` : label}
    </MenuSwitchItem>
  );
}

/** The active file's options menu: save, format, copy and reveal its path, file settings and discard. */
export function FileOptionsMenu({
  activeFile,
  activeDocument,
  workspace,
  editors,
  menuRef,
  main,
  sidePanel,
  leading,
  onCopyPath,
  onDiscard,
}: {
  readonly activeFile: FileTab | undefined;
  readonly activeDocument: Document | undefined;
  readonly workspace: SelectedWorkspace | undefined;
  readonly editors: RefObject<Map<string, FileEditorHandle>>;
  readonly menuRef: RefObject<HTMLButtonElement | null>;
  /** The Editor is the window's main area, so the menu sits in the title bar. */
  readonly main: boolean;
  readonly sidePanel: "start" | "end";
  /** Items above the file's own, such as the open files. */
  readonly leading?: ReactNode;
  readonly onCopyPath: (path: string) => void;
  readonly onDiscard: (path: string | undefined) => void;
}): ReactElement {
  const formats =
    activeDocument?.kind === "text" &&
    workspace !== undefined &&
    workspaceFile(activeDocument.path, [workspace.path]) !== undefined;

  const unsaved = activeFile?.dirty === true;
  const revealPath = nyte.host.revealPath;

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size={main ? undefined : "sm"}
            iconOnly
            ref={menuRef}
            icon="more-horizontal"
            aria-label={main ? "More" : "File options"}
          />
        }
      />
      <MenuContent align="end" xstyle={styles.menu}>
        {leading}
        <MenuItem
          layout="plain"
          meta={nyte.platform === "darwin" ? "⌘S" : "Ctrl+S"}
          disabled={!unsaved}
          onClick={() => {
            if (activeFile !== undefined) void editors.current.get(activeFile.id)?.save();
          }}
        >
          Save File
        </MenuItem>
        {formats && (
          <MenuItem
            layout="plain"
            onClick={() => {
              if (activeFile !== undefined) void editors.current.get(activeFile.id)?.format();
            }}
          >
            Format Document
          </MenuItem>
        )}
        <MenuSeparator inset />
        <MenuItem
          layout="plain"
          disabled={activeFile === undefined}
          onClick={() => {
            if (activeFile !== undefined) onCopyPath(activeFile.path);
          }}
        >
          Copy Path
        </MenuItem>
        <MenuItem
          layout="plain"
          disabled={activeFile === undefined || activeFile.external}
          onClick={() => {
            if (activeFile !== undefined) onCopyPath(activeFile.displayPath);
          }}
        >
          Copy Relative Path
        </MenuItem>
        {revealPath !== undefined && (
          <MenuItem
            layout="plain"
            disabled={activeFile === undefined}
            onClick={() => {
              if (activeFile !== undefined) void revealPath({ path: activeFile.path });
            }}
          >
            {revealLabel(nyte.platform)}
          </MenuItem>
        )}
        <MenuSeparator inset />
        {FILE_TOGGLES.map(([label, setting]) => (
          <FilePreferenceItem
            key={label}
            label={label}
            setting={setting}
            overridden={
              setting === preferences.fileWordWrap &&
              activeDocument?.kind === "text" &&
              opensUnwrapped(activeDocument.contents)
            }
          />
        ))}
        {!main && (
          <MenuItem
            layout="plain"
            onClick={() => preferences.editorSidePanel.set(sidePanel === "start" ? "end" : "start")}
          >
            {sidePanel === "start" ? "Move Side Panel Right" : "Move Side Panel Left"}
          </MenuItem>
        )}
        <MenuSeparator inset />
        <MenuItem
          layout="plain"
          variant={unsaved ? "danger" : "default"}
          disabled={!unsaved}
          onClick={() => onDiscard(activeFile?.path)}
        >
          Discard Changes…
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
