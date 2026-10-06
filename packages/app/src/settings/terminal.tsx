import type { ReactElement } from "react";
import { hostSetting, preferences } from "../preferences/index.ts";
import { NumberRow, SettingsSection, SwitchRow, TextRow } from "./rows.tsx";

export function TerminalSettings(): ReactElement {
  return (
    <SettingsSection>
      <TextRow
        setting={hostSetting("terminalShell")}
        title="Shell"
        description="New terminals start it as a login shell. Leave empty to use your account's shell"
        placeholder="Login shell"
      />
      <NumberRow
        setting={preferences.terminalScrollback}
        title="Scrollback"
        description="Lines each terminal keeps"
        min={1_000}
        max={100_000}
        step={1_000}
      />
      <SwitchRow
        setting={preferences.terminalCursorBlink}
        title="Blinking cursor"
        description="Blink the cursor while the terminal has focus"
      />
    </SettingsSection>
  );
}
