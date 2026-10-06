import { Input } from "@nyte-ai/ui/input";
import type { ReactElement } from "react";
import { hostSetting, useSetting } from "../preferences/index.ts";
import { SettingsRow, SettingsSection } from "./rows.tsx";

const traceEndpoint = hostSetting("traceEndpoint");

function TraceEndpointRow(): ReactElement | null {
  const value = useSetting(traceEndpoint);

  if (!traceEndpoint.available()) return null;

  return (
    <SettingsRow
      title="Trace endpoint"
      description="Send OpenTelemetry traces of agent runs to this OTLP URL. Applies at next launch"
      controlWidth="wide"
    >
      <Input
        // Keyed by the value, so a change from another window replaces the draft.
        key={value ?? ""}
        type="url"
        aria-label="Trace endpoint"
        placeholder="http://localhost:4318"
        defaultValue={value ?? ""}
        disabled={value === undefined}
        onBlur={(event) => {
          const next = event.currentTarget.value.trim();

          if (next !== (value ?? "")) traceEndpoint.set(next === "" ? null : next);
        }}
      />
    </SettingsRow>
  );
}

export function AdvancedSettings(): ReactElement {
  return (
    <SettingsSection title="Diagnostics">
      <TraceEndpointRow />
    </SettingsSection>
  );
}
