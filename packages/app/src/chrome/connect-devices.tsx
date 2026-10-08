/**
 * The devices the Nyte account enrolled to reach this Mac, as a card of their
 * own under the Mac's row. Revoking one refuses it here at once and ends the
 * Nyte sign-in that enrolled it.
 */
import { srOnly } from "@nyte-ai/ui/a11y.stylex";
import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { create, props } from "@stylexjs/stylex";
import { useState } from "react";
import type { ReactElement } from "react";
import type { ConnectBridge, ConnectDevice } from "../bridge.ts";
import { settings } from "../theme/schema.stylex.ts";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import { useConnectAction } from "./connect-view.ts";
import type { LinkedView } from "./connect-view.ts";
import { ConnectionRow } from "./connection-list.tsx";

const styles = create({
  header: {
    padding: settings.rowPadding,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondaryTranslucent,
    color: role.contentPrimary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
  },
});

function deviceDetail(device: ConnectDevice, view: LinkedView): string {
  const added = `Added ${new Date(device.createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;

  return view.lease.kind === "current" && !device.authorized ? `Not active yet · ${added}` : added;
}

export function ConnectDevices({
  view,
  connect,
}: {
  readonly view: LinkedView;
  readonly connect: ConnectBridge;
}): ReactElement | null {
  const [target, setTarget] = useState<ConnectDevice>();
  const [confirming, setConfirming] = useState(false);

  const revoke = useConnectAction(
    (deviceId: string) => connect.revokeDevice({ deviceId }),
    "Couldn’t revoke the device",
  );

  const { devices } = view;

  if (devices.length === 0) return null;

  return (
    <section aria-label="Devices" {...props(settingsPatterns.group)}>
      <div {...props(styles.header)}>
        {devices.length === 1 ? "1 device" : `${String(devices.length)} devices`}
      </div>
      {devices.map((device) => (
        <ConnectionRow
          key={device.id}
          glyph={<Icon name={/browser/i.test(device.name) ? "globe" : "phone"} size={16} />}
          title={device.name}
          detail={deviceDetail(device, view)}
          control={
            <Button
              variant="ghost"
              loading={revoke.isPending && revoke.variables === device.id}
              disabled={revoke.isPending}
              onClick={() => {
                setTarget(device);
                setConfirming(true);
              }}
            >
              Revoke…
              <span {...props(srOnly)}>{` ${device.name}`}</span>
            </Button>
          }
        />
      ))}
      {target !== undefined && (
        <ConfirmDialog
          open={confirming}
          pending={revoke.isPending}
          title="Revoke Device"
          description={`${target.name} loses access to this Mac right away, and the Nyte sign-in used to connect it ends.`}
          confirmLabel="Revoke Device"
          pendingLabel="Revoking…"
          onOpenChange={setConfirming}
          onConfirm={() => revoke.mutate(target.id, { onSuccess: () => setConfirming(false) })}
        />
      )}
    </section>
  );
}
