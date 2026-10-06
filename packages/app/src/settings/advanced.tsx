import type { ReactElement } from "react";
import { hostSetting } from "../preferences/index.ts";
import { SettingsSection, TextRow } from "./rows.tsx";

export function AdvancedSettings(): ReactElement {
  return (
    <SettingsSection title="Diagnostics">
      <TextRow
        setting={hostSetting("traceEndpoint")}
        type="url"
        title="Trace endpoint"
        description="Send OpenTelemetry traces of agent runs to this OTLP URL. Applies at next launch"
        placeholder="http://localhost:4318"
      />
    </SettingsSection>
  );
}
