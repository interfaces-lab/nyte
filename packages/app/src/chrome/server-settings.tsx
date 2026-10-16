/**
 * Remote access, the inbound connection: this desktop serving one of its own
 * local stores, with the web app on the same address, to a browser or the iOS
 * app. The Nyte account option comes first; this Mac only, Tailscale, and the
 * user's own Cloudflare tunnel follow as manual setup. Nothing here touches
 * local providers.
 */
import { props } from "@stylexjs/stylex";
import { focusManager, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { toast } from "@nyte-ai/ui/toast";
import { errorMessage } from "../errors.ts";
import type {
  RemoteAccessState,
  RemoteReach,
  ServedTarget,
  TailnetAvailability,
} from "../bridge.ts";
import { Icon } from "@nyte-ai/ui/icon";
import { Button, ButtonLink } from "@nyte-ai/ui/button";
import { Tabs } from "@nyte-ai/ui/tabs";
import { Toggle } from "@nyte-ai/ui/toggle";
import { MenuItem } from "@nyte-ai/ui/menu";
import { nyte } from "../nyte.ts";
import { openExternal } from "../open-external.ts";
import { keys, useRemoteAccessState } from "../queries.ts";
import { ConnectionList, ConnectionMenu, ConnectionRow } from "./connection-list.tsx";
import { modelsSettingsStyles as styles } from "./models-settings.stylex.ts";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { NyteConnection } from "./nyte-connection.tsx";
import { PairingCode, pairingPayload } from "./pairing-code.tsx";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import { CopyButton, shareStyles } from "./remote-share.tsx";
import { TunnelRow, TunnelServingPanel, tunnelStatus } from "./remote-tunnel.tsx";

type TokenServing = Extract<RemoteAccessState, { kind: "serving"; reach: "local" | "tailnet" }>;

function servedTargetLabel(target: ServedTarget): string {
  return target.kind === "home" ? "Home" : target.workspace.name;
}

/** The link, address, and token a client needs, with the token hidden until asked for. */
function ServingPanel({ state }: { state: TokenServing }) {
  const [revealed, setRevealed] = useState(false);
  const [step, setStep] = useState<"scan" | "details">("scan");
  const payload = pairingPayload({ address: state.address, token: state.token });

  const hidden = "••••••••••••••••";

  return (
    <Tabs.Root
      variant="segmented"
      value={step}
      onValueChange={(value) => {
        if (value === "scan" || value === "details") setStep(value);
      }}
      {...props(shareStyles.panel)}
    >
      <div {...props(shareStyles.fields)}>
        <span {...props(text.sm, shareStyles.label)}>Link</span>
        <code aria-label="Pairing link" {...props(text.sm, shareStyles.value)}>
          {revealed ? state.pairingUrl : state.pairingUrl.replace(state.token, hidden)}
        </code>
        <span {...props(shareStyles.fieldActions)}>
          <CopyButton label="Pairing link" value={state.pairingUrl} />
          <ButtonLink
            href={state.pairingUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => {
              event.preventDefault();
              openExternal(state.pairingUrl, "Couldn't open the pairing link. Copy it instead.");
            }}
          >
            Open Pairing Link
          </ButtonLink>
        </span>
      </div>
      <Tabs.List aria-label="Pairing method" xstyle={shareStyles.switcher}>
        <Tabs.Tab value="scan">Scan</Tabs.Tab>
        <Tabs.Tab value="details">Address and Token</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="scan" xstyle={shareStyles.step}>
        <div {...props(shareStyles.scan)}>
          <PairingCode value={payload} size={132} />
          <span {...props(shareStyles.scanText)}>
            <span {...props(text.sm, shareStyles.label)}>
              In the iOS app, tap Scan QR code on the connect screen.
            </span>
            <span {...props(text.sm, styles.deviceCodeNote)}>
              The code carries the token, so treat it like the token itself. It stops working when
              you stop.
            </span>
          </span>
        </div>
      </Tabs.Panel>
      <Tabs.Panel value="details" xstyle={shareStyles.step}>
        <div {...props(shareStyles.fields)}>
          <span {...props(text.sm, shareStyles.label)}>Address</span>
          <code aria-label="Address" {...props(text.sm, shareStyles.value)}>
            {state.address}
          </code>
          <span {...props(shareStyles.fieldActions)}>
            <CopyButton label="Address" value={state.address} />
          </span>
          <span {...props(text.sm, shareStyles.label)}>Token</span>
          <code aria-label="Token" {...props(text.sm, shareStyles.value)}>
            {revealed ? state.token : hidden}
          </code>
          <span {...props(shareStyles.fieldActions)}>
            <CopyButton label="Token" value={state.token} />
            <Toggle
              iconOnly
              icon="eye"
              aria-label={revealed ? "Hide token" : "Reveal token"}
              pressed={revealed}
              onPressedChange={setRevealed}
            />
          </span>
        </div>
        <span {...props(text.sm, styles.deviceCodeNote)}>
          {state.reach === "tailnet"
            ? "Reachable from your signed-in Tailscale devices on any network, and from nothing else. The token is new each time and never written to disk."
            : "Only this Mac can reach this address, so a physical phone can't. The token is new each time and never written to disk."}
        </span>
      </Tabs.Panel>
    </Tabs.Root>
  );
}

function tailnetDetail(tailnet: TailnetAvailability): string {
  if (tailnet.kind === "missing") return "Tailscale isn't installed on this Mac.";

  if (tailnet.kind === "unavailable") return "Tailscale isn't running. Start it, then try again.";

  return `Reachable at ${tailnet.name ?? tailnet.ip} from your signed-in devices, on any network.`;
}

export function RemoteAccess({ active }: { readonly active: boolean }): ReactElement {
  const client = useQueryClient();
  const remote = useRemoteAccessState(active);

  const start = useMutation({
    mutationFn: (reach: RemoteReach) => nyte.host.remote.start({ reach }),
    onError: (cause) =>
      toast.add({
        type: "error",
        title: `Couldn't start remote access: ${errorMessage(cause)}`,
        id: "remote-access",
      }),
    onSettled: () => client.invalidateQueries({ queryKey: keys.remoteAccess }),
  });

  const stop = useMutation({
    mutationFn: () => nyte.host.remote.stop(),
    onError: (cause) =>
      toast.add({
        type: "error",
        title: `Couldn't stop remote access: ${errorMessage(cause)}`,
        id: "remote-access",
      }),
    onSettled: () => client.invalidateQueries({ queryKey: keys.remoteAccess }),
  });

  const state = remote.data;
  const pending = start.isPending || stop.isPending;

  const stopItem = <MenuItem onClick={() => stop.mutate()}>Stop Remote Access</MenuItem>;

  return (
    <>
      <NyteConnection connect={nyte.host.connect} active={active} />
      <div {...props(settingsPatterns.sectionHeader)}>
        <h2 {...props(settingsPatterns.sectionTitle)}>Manual setup</h2>
      </div>
      <ConnectionList>
        {state === undefined ? null : state.kind === "off" ? (
          <>
            <ConnectionRow
              glyph={<Icon name="computer" size={16} />}
              title="This Mac only"
              detail="Serves the selected folder. Switching folders here afterwards doesn't move it; a connected client can."
              control={
                <Button
                  variant="outline"

                  loading={start.isPending && start.variables === "local"}
                  disabled={pending && start.variables !== "local"}
                  onClick={() => start.mutate("local")}
                >
                  Start
                </Button>
              }
            />
            <ConnectionRow
              glyph={<Icon name="devices" size={16} />}
              title="Over Tailscale"
              detail={tailnetDetail(state.tailnet)}
              control={
                <Button
                  variant="outline"

                  loading={start.isPending && start.variables === "tailnet"}
                  disabled={
                    state.tailnet.kind !== "ready" || (pending && start.variables !== "tailnet")
                  }
                  onClick={() => start.mutate("tailnet")}
                >
                  Start
                </Button>
              }
            />
            <TunnelRow
              tunnel={state.cloudflare}
              starting={start.isPending && start.variables === "cloudflare"}
              disabled={pending && start.variables !== "cloudflare"}
              onStart={() => start.mutate("cloudflare")}
            />
          </>
        ) : state.reach === "cloudflare" ? (
          <ConnectionRow
            glyph={<Icon name="cloudflare" size={16} />}
            title={`Serving ${servedTargetLabel(state.target)}`}
            detail={state.address}
            control={
              <ConnectionMenu
                label="Remote access"
                {...tunnelStatus(state.cloudflare)}
                loading={stop.isPending}
                disabled={start.isPending}
              >
                {stopItem}
              </ConnectionMenu>
            }
            expansion={
              state.cloudflare.kind === "configured" ? (
                <TunnelServingPanel tunnel={state.cloudflare} />
              ) : undefined
            }
          />
        ) : (
          <ConnectionRow
            glyph={<Icon name={state.reach === "tailnet" ? "devices" : "computer"} size={16} />}
            title={`Serving ${servedTargetLabel(state.target)}`}
            detail={state.target.kind === "home" ? undefined : state.target.workspace.path}
            control={
              <ConnectionMenu
                label="Remote access"
                tone="on"
                status={state.reach === "tailnet" ? "Over Tailscale" : "This Mac only"}
                loading={stop.isPending}
                disabled={start.isPending}
              >
                {stopItem}
              </ConnectionMenu>
            }
            expansion={<ServingPanel state={state} />}
          />
        )}
      </ConnectionList>
    </>
  );
}

const subscribeToWindowFocus = (notify: () => void): (() => void) => focusManager.subscribe(notify);

const readWindowFocus = (): boolean => focusManager.isFocused();

/** Connection state is polled only while the window has focus. */
export function useWindowFocused(): boolean {
  return useSyncExternalStore(subscribeToWindowFocus, readWindowFocus, readWindowFocus);
}
