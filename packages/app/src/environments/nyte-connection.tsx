import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import { Button } from "@nyte-ai/ui/button";
import { intent } from "@nyte-ai/ui/surface-theme";
import { props } from "@stylexjs/stylex";
import { useRef, useState } from "react";
import type { ReactElement } from "react";
import type { ConnectBridge } from "../contract/bridge.ts";
import { errorMessage } from "../contract/errors.ts";
import { SettingsSection, SettingsSwitchRow } from "../settings/rows.tsx";
import {
  linkedStanding,
  noticeNote,
  unavailableDetail,
  useConnectAction,
  useConnectView,
} from "../account/connect-view.ts";
import type { LinkedView } from "../account/connect-view.ts";
import { ConnectDevices } from "./connect-devices.tsx";
import { FactRow } from "../components/connection-list.tsx";
import { LinkTray } from "../account/link-tray.tsx";

const TITLE = "Nyte account";

function deviceCount(count: number): string {
  if (count === 0) return "No devices";

  return count === 1 ? "1 device" : `${String(count)} devices`;
}

function LinkedConnection({
  view,
  connect,
}: {
  readonly view: LinkedView;
  readonly connect: ConnectBridge;
}): ReactElement {
  const [confirming, setConfirming] = useState(false);
  const unlinkRef = useRef<HTMLButtonElement>(null);

  const setEnabled = useConnectAction(
    (enabled: boolean) => connect.setEnabled({ enabled }),
    "Couldn’t change remote access",
  );

  const unlink = useConnectAction(() => connect.unlink(), "Couldn’t unlink this Mac");

  const standing = linkedStanding(view);
  const { owner, devices } = view;

  return (
    <SettingsSection
      title={TITLE}
      note={
        standing.note === undefined ? (
          devices.length === 0 ? (
            `No devices yet. Sign in to the Nyte iOS app as ${owner.label} to add one.`
          ) : undefined
        ) : (
          <span role="alert" {...props(intent.danger)}>
            {standing.note}
          </span>
        )
      }
    >
      <FactRow
        icon="user"
        tone={view.enabled ? "on" : "neutral"}
        title={`Linked to ${owner.label}`}
        detail={`${view.environment.name} · ${deviceCount(devices.length)}`}
      >
        <Button ref={unlinkRef} variant="outline" onClick={() => setConfirming(true)}>
          Unlink This Mac…
        </Button>
      </FactRow>
      <SettingsSwitchRow
        title="Remote access"
        description={
          view.enabled
            ? standing.status
            : "Devices signed in to this account can connect from any network"
        }
        checked={view.enabled}
        disabled={setEnabled.isPending || unlink.isPending}
        onCheckedChange={(enabled) => setEnabled.mutate(enabled)}
      />
      <ConnectDevices view={view} connect={connect} />
      <ConfirmDialog
        open={confirming}
        pending={unlink.isPending}
        finalFocus={unlinkRef}
        title="Unlink this Mac?"
        description={`Devices signed in as ${owner.label} lose access to this Mac right away, and it leaves that account.`}
        confirmLabel="Unlink This Mac"
        pendingLabel="Unlinking…"
        onOpenChange={setConfirming}
        onConfirm={() => unlink.mutate(undefined, { onSuccess: () => setConfirming(false) })}
      />
    </SettingsSection>
  );
}

/** The Nyte account group: link this Mac, turn remote access on, and manage its devices. */
export function NyteConnection({
  connect,
}: {
  readonly connect: ConnectBridge;
}): ReactElement | null {
  const [trayOpen, setTrayOpen] = useState(false);
  const state = useConnectView(connect);
  const view = state.data;

  if (view === undefined) {
    return (
      <SettingsSection title={TITLE}>
        <FactRow
          icon="user"
          title={TITLE}
          detail={state.isError ? errorMessage(state.error) : "Checking…"}
        />
      </SettingsSection>
    );
  }

  if (view.kind === "unavailable") {
    return view.reason === "not_configured" ? null : (
      <SettingsSection title={TITLE}>
        <FactRow icon="user" title="Unavailable" detail={unavailableDetail(view.reason)} />
      </SettingsSection>
    );
  }

  if (view.kind === "linked" && !trayOpen)
    return <LinkedConnection view={view} connect={connect} />;

  return (
    <SettingsSection title={TITLE}>
      <FactRow
        icon="user"
        title="Not linked"
        detail={
          view.kind === "unlinked"
            ? (noticeNote(view.notice) ?? "Reach this Mac from your iPhone on any network.")
            : undefined
        }
      >
        <LinkTray
          connect={connect}
          open={trayOpen}
          onOpenChange={setTrayOpen}
          side="bottom"
          trigger={<Button variant="outline">Link This Mac…</Button>}
        />
      </FactRow>
    </SettingsSection>
  );
}
