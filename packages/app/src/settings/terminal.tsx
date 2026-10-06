import type { ReactElement } from "react";
import { preferences } from "../preferences/index.ts";
import { NumberRow, SettingsSection, SwitchRow } from "./rows.tsx";

export function TerminalSettings(): ReactElement {
  return (
    <SettingsSection>
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
