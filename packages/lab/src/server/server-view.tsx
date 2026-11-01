/**
 * The Server page as one object: a hero row for the server's lifecycle with its one verb, the
 * address row that keeps its place while it resolves, and reach as a choice instead of two
 * switches that block each other. Built from the app's own settings rows and buttons.
 */
import { create, props } from "@stylexjs/stylex";
import { useState, type ActionDispatch, type ReactElement } from "react";
import { FactRow } from "@nyte-ai/app/components/connection-list.tsx";
import { PairingCode, pairingPayload } from "@nyte-ai/app/environments/pairing-code.tsx";
import { CopyButton, ValueRow, shareStyles } from "@nyte-ai/app/environments/remote-share.tsx";
import { SettingsDialog, SettingsDialogCard } from "@nyte-ai/app/settings/dialog.tsx";
import { SettingsRow, SettingsSection } from "@nyte-ai/app/settings/rows.tsx";
import { settingsPatterns } from "@nyte-ai/app/theme/settings-patterns.stylex.ts";
import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import { Button } from "@nyte-ai/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@nyte-ai/ui/select";
import { Spinner } from "@nyte-ai/ui/spinner";
import { intent } from "@nyte-ai/ui/surface-theme";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { REACHES, reachLabel, uptime, type Action, type Address, type World } from "./model";

const TOKEN = "nyte_7Fq2xLk9Vb3mRt8Wz";

const TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

export function ServerView({
  world,
  now,
  dispatch,
}: {
  readonly world: World;
  readonly now: number;
  readonly dispatch: ActionDispatch<[Action]>;
}): ReactElement {
  const [stopping, setStopping] = useState(false);
  const server = world.server;

  return (
    <>
      <SettingsSection>
        <div data-settings-row="" {...props(settingsPatterns.row)}>
          <img src="/icon.svg" alt="" width={44} height={44} {...props(styles.mark)} />
          <span {...props(settingsPatterns.rowCopy)}>
            <span {...props(settingsPatterns.rowTitle, styles.heroTitle)}>Nyte Server</span>
            <span {...props(settingsPatterns.rowDescription)}>
              {server.kind === "off" ? (
                "Not running"
              ) : (
                <>
                  <Tooltip>
                    <TooltipTrigger render={<span {...props(styles.since)} />}>
                      Running for {uptime(now - server.since)}
                    </TooltipTrigger>
                    <TooltipContent>Started at {TIME.format(server.since)}</TooltipContent>
                  </Tooltip>
                  {` · ${reachLabel(world.reach)}`}
                </>
              )}
            </span>
          </span>
          {server.kind === "off" ? (
            <Button
              variant="solid"
              tone="primary"
              onClick={() => dispatch({ kind: "start", now: Date.now() })}
            >
              Start Server
            </Button>
          ) : (
            <Button variant="ghost" tone="danger" onClick={() => setStopping(true)}>
              Stop Server…
            </Button>
          )}
        </div>
      </SettingsSection>

      {server.kind === "running" && (
        <SettingsSection>
          <AddressRow address={server.address} onRetry={() => dispatch({ kind: "retry" })} />
        </SettingsSection>
      )}

      <SettingsSection
        title="Reach"
        note={
          server.kind === "running"
            ? "Switching restarts the server and disconnects devices connected now."
            : undefined
        }
      >
        <SettingsRow title="Serve over" description="How your other devices find this Mac">
          <Select
            items={REACHES}
            value={world.reach}
            onValueChange={(next) => {
              if (next !== null) dispatch({ kind: "reach", reach: next, now: Date.now() });
            }}
          >
            <SelectTrigger aria-label="Serve over">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REACHES.map((option) => (
                <SelectItem key={option.value} value={option.value} label={option.label}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
        {world.reach === "tailnet" ? (
          <FactRow icon="devices" title="Tailscale" detail="Running on this Mac as studio" />
        ) : (
          <FactRow icon="cloudflare" title="nyte.example.com" detail="Your named tunnel, port 5182">
            <Button variant="outline">Change Tunnel…</Button>
          </FactRow>
        )}
      </SettingsSection>

      <ConfirmDialog
        open={stopping}
        title="Stop Nyte Server?"
        description={`Devices connected over ${reachLabel(world.reach)} are disconnected. Chats already running keep going.`}
        confirmLabel="Stop Server"
        onOpenChange={setStopping}
        onConfirm={() => {
          setStopping(false);
          dispatch({ kind: "stop" });
        }}
      />
    </>
  );
}

/**
 * Copy and Pair hold their places through every state, so the row never reflows when the address
 * lands; a failure trades Pair for the one action that helps.
 */
function AddressRow({
  address,
  onRetry,
}: {
  readonly address: Address;
  readonly onRetry: () => void;
}): ReactElement {
  const [pairing, setPairing] = useState(false);

  return (
    <div data-settings-row="" {...props(settingsPatterns.row)}>
      <span {...props(settingsPatterns.rowCopy)}>
        <span {...props(settingsPatterns.rowTitle)}>Remote address</span>
        <span {...props(settingsPatterns.rowDescription)}>
          {address.kind === "resolving" ? (
            <Starting />
          ) : address.kind === "ready" ? (
            <code {...props(shareStyles.value, styles.address)}>{address.url}</code>
          ) : (
            <span role="alert" {...props(intent.danger, styles.failure)}>
              {address.message}
            </span>
          )}
        </span>
      </span>
      <span {...props(shareStyles.actions)}>
        {address.kind === "ready" ? (
          <CopyButton label="Address" value={address.url} />
        ) : (
          <Button variant="ghost" iconOnly icon="copy" aria-label="Copy address" disabled />
        )}
        {address.kind === "failed" ? (
          <Button variant="outline" icon="refresh" onClick={onRetry}>
            Try Again
          </Button>
        ) : (
          <Button
            variant="ghost"
            tone="primary"
            icon="phone"
            disabled={address.kind !== "ready"}
            onClick={() => setPairing(true)}
          >
            Pair…
          </Button>
        )}
      </span>
      {address.kind === "ready" && (
        <SettingsDialog
          open={pairing}
          title="Pair a Device"
          description="In the Nyte iOS app, tap Scan QR code. The code carries the token, so treat it like a password."
          onOpenChange={setPairing}
        >
          <div {...props(shareStyles.pair)}>
            <PairingCode
              value={pairingPayload({ address: address.url, token: TOKEN })}
              size={160}
            />
          </div>
          <SettingsDialogCard>
            <ValueRow title="Address" value={address.url}>
              <CopyButton label="Address" value={address.url} />
            </ValueRow>
          </SettingsDialogCard>
        </SettingsDialog>
      )}
    </div>
  );
}

function Starting(): ReactElement {
  return (
    <span role="status" {...props(styles.status)}>
      <Spinner />
      Starting…
    </span>
  );
}

const styles = create({
  mark: { flex: "none", borderRadius: radius.control },
  heroTitle: { fontSize: type.fontLg, fontWeight: type.weightSemibold, lineHeight: type.leadingLg },
  since: {
    textDecorationLine: "underline",
    textDecorationStyle: "dotted",
    textDecorationColor: role.contentTertiary,
    textUnderlineOffset: 3,
    cursor: "default",
  },
  status: { display: "inline-flex", alignItems: "center", gap: space.s1_5 },
  address: { display: "block", fontSize: type.fontBase, lineHeight: type.leadingBase },
  failure: { textWrap: "pretty" },
});
