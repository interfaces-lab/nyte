import type { ReactElement } from "react";
import { Deferred } from "../lib/deferred.tsx";
import { preferences } from "../preferences/index.ts";
import { SelectRow, SettingsSection, SwitchRow } from "./rows.tsx";

const LAYOUTS = [
  { value: "unified", label: "Unified" },
  { value: "split", label: "Split" },
] as const;

export function EditorSettings(): ReactElement {
  return (
    <>
      <SettingsSection
        title="Editing"
        preview={
          <Deferred entry="previews">{(previews) => <previews.FileEditorPreview />}</Deferred>
        }
      >
        <SwitchRow
          setting={preferences.fileLineNumbers}
          title="Line numbers"
          description="Show a line number gutter in open files"
        />
        <SwitchRow
          setting={preferences.fileWordWrap}
          title="Word wrap"
          description="Wrap long lines in open files instead of scrolling sideways"
        />
        <SwitchRow
          setting={preferences.fileGitBlame}
          title="Git blame"
          description="Show the author, date, and commit message for the current line"
        />
        <SwitchRow
          setting={preferences.fileAutoSave}
          title="Auto save"
          description="Save 1 second after you stop typing"
        />
        <SwitchRow
          setting={preferences.fileFormatOnSave}
          title="Format on save"
          description="Run the workspace formatter each time a file saves"
        />
      </SettingsSection>
      <SettingsSection
        title="Changes"
        preview={<Deferred entry="previews">{(previews) => <previews.ChangesPreview />}</Deferred>}
        note="Each repository can still pick its own layout from the Changes menu."
      >
        <SelectRow setting={preferences.changesLayout} title="Diff layout" options={LAYOUTS} />
        <SwitchRow
          setting={preferences.changesIgnoreWhitespace}
          title="Ignore whitespace"
          description="Hide lines that only change whitespace"
        />
        <SwitchRow
          setting={preferences.changesWordWrap}
          title="Word wrap"
          description="Wrap long lines in diffs instead of scrolling sideways"
        />
      </SettingsSection>
    </>
  );
}
