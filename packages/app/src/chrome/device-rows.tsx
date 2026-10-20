import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { settings } from "../theme/schema.stylex.ts";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import { ConnectionRow } from "./connection-list.tsx";

const styles = create({
  header: {
    padding: settings.rowPadding,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondaryTranslucent,
    color: role.contentPrimary,
  },
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
    <section aria-label={label} {...props(settingsPatterns.group)}>
      <div {...props(text.base, styles.header)}>
        {devices.length === 1 ? "1 device" : `${String(devices.length)} devices`}
      </div>
      {devices.map((device) => (
        <ConnectionRow
          key={device.id}
          glyph={<Icon name={/browser/i.test(device.name) ? "globe" : "phone"} size={16} />}
          title={device.name}
          detail={device.detail}
          control={
            <Button
              variant="ghost"
              loading={pending === device.id}
              disabled={pending !== undefined}
              onClick={() => onAction(device.id)}
            >
              {action}
              <span {...props(srOnly)}>{` ${device.name}`}</span>
            </Button>
          }
        />
      ))}
    </section>
  );
}
