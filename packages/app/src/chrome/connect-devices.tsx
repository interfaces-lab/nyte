/** The Nyte account's linked devices; revoking one asks first, since it also ends that sign-in. */
import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import { useState } from "react";
import type { ReactElement } from "react";
import type { ConnectBridge, ConnectDevice } from "../bridge.ts";
import { useConnectAction } from "./connect-view.ts";
import type { LinkedView } from "./connect-view.ts";
import { DeviceRows } from "./device-rows.tsx";

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
}): ReactElement {
  const [target, setTarget] = useState<ConnectDevice>();
  const [confirming, setConfirming] = useState(false);

  const revoke = useConnectAction(
    (deviceId: string) => connect.revokeDevice({ deviceId }),
    "Couldn’t revoke the device",
  );

  return (
    <>
      <DeviceRows
        label="Devices"
        devices={view.devices.map((device) => ({
          id: device.id,
          name: device.name,
          detail: deviceDetail(device, view),
        }))}
        action="Revoke…"
        pending={revoke.isPending ? revoke.variables : undefined}
        onAction={(deviceId) => {
          setTarget(view.devices.find((device) => device.id === deviceId));
          setConfirming(true);
        }}
      />
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
    </>
  );
}
