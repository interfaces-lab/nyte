import type { ReactElement } from "react";
import { Deferred } from "../lib/deferred.tsx";
import { DESKTOP_SETTING_SCHEMAS } from "../contract/desktop-settings.ts";
import { preferences } from "../preferences/index.ts";
import { pluginSetting } from "../preferences/plugin.ts";
import { NumberRow, SelectRow, SettingsSection, SwitchRow, TextRow } from "./rows.tsx";

export const terminalShell = pluginSetting(
  "desktop.terminalShell",
  DESKTOP_SETTING_SCHEMAS.terminalShell,
);

const CURSOR_STYLES = [
  { value: "block", label: "Block" },
  { value: "bar", label: "Bar" },
  { value: "underline", label: "Underline" },
] as const;

export function TerminalSettings(): ReactElement {
  return (
    <SettingsSection
      preview={<Deferred entry="previews">{(previews) => <previews.TerminalPreview />}</Deferred>}
      note="Shell and scrollback apply to new terminals. The cursor changes in open ones too."
    >
      <TextRow
        setting={terminalShell}
        title="Shell"
        description="New terminals start it as a login shell. Leave empty to use your account's shell"
        placeholder="Login shell"
        needs={["desktop"]}
      />
      <NumberRow
        setting={preferences.terminalScrollback}
        title="Scrollback"
        description="Lines each terminal keeps"
        min={1_000}
        max={100_000}
        step={1_000}
      />
      <SelectRow
        setting={preferences.terminalCursorStyle}
        title="Cursor style"
        options={CURSOR_STYLES}
      />
      <SwitchRow
        setting={preferences.terminalCursorBlink}
        title="Blinking cursor"
        description="Blink the cursor while the terminal has focus"
      />
    </SettingsSection>
  );
}
