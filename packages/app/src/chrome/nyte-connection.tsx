/**
 * The Nyte account's row in Environments › Remote access. Unlinked, it offers
 * the link tray; linked, its status menu turns access on or off and unlinks,
 * and the devices the account enrolled are listed under it. Who is signed in
 * on this Mac is Profile's business, not this row's.
 */
import { srOnly } from "@nyte-ai/ui/a11y.stylex";
import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { MenuItem, MenuSeparator } from "@nyte-ai/ui/menu";
import { intent } from "@nyte-ai/ui/surface-theme";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { create, props } from "@stylexjs/stylex";
import { useRef, useState } from "react";
import type { ReactElement } from "react";
import type { ConnectBridge } from "../bridge.ts";
import { errorMessage } from "../errors.ts";
import {
  linkedStanding,
  noticeNote,
  unavailableDetail,
  useConnectAction,
  useConnectView,
} from "./connect-view.ts";
import type { LinkedView } from "./connect-view.ts";
import { ConnectionList, ConnectionMenu, ConnectionRow } from "./connection-list.tsx";
import { LinkTray } from "./link-tray.tsx";

const styles = create({
  expansion: { display: "flex", flexDirection: "column", gap: 6 },
  note: { color: role.contentSecondary, fontSize: type.fontSm, lineHeight: type.leadingSm },
  devices: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  device: { display: "flex", alignItems: "center", gap: 8 },
  deviceName: {
    flexGrow: 1,
    minWidth: 0,
    color: role.contentPrimary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    overflowWrap: "anywhere",
  },
});

const TITLE = "Nyte account";

const glyph = <Icon name="phone" size={16} />;

function LinkedConnection({
  view,
  connect,
}: {
  readonly view: LinkedView;
  readonly connect: ConnectBridge;
}): ReactElement {
  const [confirming, setConfirming] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);

  const setEnabled = useConnectAction(
    (enabled: boolean) => connect.setEnabled({ enabled }),
    "Couldn’t change remote access",
  );

  const unlink = useConnectAction(() => connect.unlink(), "Couldn’t unlink this Mac");

  const revoke = useConnectAction(
    (deviceId: string) => connect.revokeDevice({ deviceId }),
    "Couldn’t revoke the device",
  );

  const standing = linkedStanding(view);
  const { owner, devices } = view;

  return (
    <>
      <ConnectionRow
        glyph={glyph}
        title={TITLE}
        detail={`${owner.label} · ${view.environment.name}`}
        control={
          <ConnectionMenu
            ref={menuRef}
            label={TITLE}
            tone={standing.tone}
            status={standing.status}
            loading={setEnabled.isPending || unlink.isPending}
          >
            <MenuItem onClick={() => setEnabled.mutate(!view.enabled)}>
              {view.enabled ? "Turn Off Remote Access" : "Turn On Remote Access"}
            </MenuItem>
            <MenuSeparator />
            <MenuItem variant="danger" onClick={() => setConfirming(true)}>
              Unlink This Mac…
            </MenuItem>
          </ConnectionMenu>
        }
        expansion={
          <div {...props(styles.expansion)}>
            {standing.note !== undefined && (
              <span role="alert" {...props(intent.danger, styles.note)}>
                {standing.note}
              </span>
            )}
            {devices.length === 0 ? (
              <span {...props(styles.note)}>
                {`No devices yet. Sign in to the Nyte iOS app as ${owner.label} to add one.`}
              </span>
            ) : (
              <ul aria-label="Devices" {...props(styles.devices)}>
                {devices.map((device) => (
                  <li key={device.id} {...props(styles.device)}>
                    <span {...props(styles.deviceName)}>{device.name}</span>
                    {view.lease.kind === "current" && !device.authorized && (
                      <span {...props(styles.note)}>Not authorized yet</span>
                    )}
                    <Button
                      loading={revoke.isPending && revoke.variables === device.id}
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(device.id)}
                    >
                      Revoke
                      <span {...props(srOnly)}>{` ${device.name}`}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        }
      />
      <ConfirmDialog
        open={confirming}
        pending={unlink.isPending}
        finalFocus={menuRef}
        title="Unlink This Mac"
        description={`Devices signed in as ${owner.label} lose access to this Mac right away, and it leaves that account.`}
        confirmLabel="Unlink This Mac"
        pendingLabel="Unlinking…"
        onOpenChange={setConfirming}
        onConfirm={() => unlink.mutate(undefined, { onSuccess: () => setConfirming(false) })}
      />
    </>
  );
}

export function NyteConnection({
  connect,
  active,
}: {
  readonly connect: ConnectBridge;
  readonly active: boolean;
}): ReactElement | null {
  const [trayOpen, setTrayOpen] = useState(false);
  const state = useConnectView(connect, active);
  const view = state.data;

  if (view === undefined) {
    return (
      <ConnectionList>
        <ConnectionRow
          glyph={glyph}
          title={TITLE}
          detail={state.isError ? errorMessage(state.error) : "Checking…"}
        />
      </ConnectionList>
    );
  }

  if (view.kind === "unavailable") {
    return view.reason === "not_configured" ? null : (
      <ConnectionList>
        <ConnectionRow glyph={glyph} title={TITLE} detail={unavailableDetail(view.reason)} />
      </ConnectionList>
    );
  }

  if (view.kind === "linked" && !trayOpen) {
    return (
      <ConnectionList>
        <LinkedConnection view={view} connect={connect} />
      </ConnectionList>
    );
  }

  return (
    <ConnectionList>
      <ConnectionRow
        glyph={glyph}
        title={TITLE}
        detail={
          view.kind === "unlinked"
            ? (noticeNote(view.notice) ?? "Reach this Mac from your iPhone on any network.")
            : undefined
        }
        control={
          <LinkTray
            connect={connect}
            open={trayOpen}
            onOpenChange={setTrayOpen}
            side="bottom"
            trigger={<Button variant="outline">Link This Mac…</Button>}
          />
        }
      />
    </ConnectionList>
  );
}
