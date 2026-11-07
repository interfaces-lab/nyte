import { Button } from "@nyte-ai/ui/button";
import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import { FactRow } from "../components/connection-list.tsx";

const styles = create({
  list: { display: "flex", flexDirection: "column" },
});

interface DeviceEntry {
  readonly id: string;
  readonly name: string;
  readonly detail: string;
}

export function DeviceRows({
  label,
  devices,
  action,
  pending,
  onAction,
}: {
  readonly label: string;
  readonly devices: readonly DeviceEntry[];
  readonly action: string;
  readonly pending: string | undefined;
  readonly onAction: (deviceId: string) => void;
}): ReactElement | null {
  if (devices.length === 0) return null;

  return (
    <div role="group" aria-label={label} {...props(settingsPatterns.rowRule, styles.list)}>
      {devices.map((device) => (
        <FactRow
          key={device.id}
          icon={/browser/i.test(device.name) ? "globe" : "phone"}
          title={device.name}
          detail={device.detail}
        >
          <Button
            variant="ghost"
            loading={pending === device.id}
            disabled={pending !== undefined}
            onClick={() => onAction(device.id)}
          >
            {action}
            <span {...props(srOnly)}>{` ${device.name}`}</span>
          </Button>
        </FactRow>
      ))}
    </div>
  );
}
