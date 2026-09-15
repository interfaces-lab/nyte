/**
 * Settings › Server has two connections that point opposite ways. The Server
 * row is outbound: a remote Nyte host this desktop reaches, whose sessions
 * appear under Cloud and run with the server's keys. The iOS row is inbound:
 * this desktop serving one of its own local stores, on loopback, to the iOS
 * app in a simulator on this Mac. Nothing here touches local providers.
 */
import { Input } from "@nyte-ai/ui";
import * as stylex from "@stylexjs/stylex";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Transition } from "motion/react";
import { useState } from "react";
import type { ReactElement } from "react";
import { toast } from "@nyte-ai/ui/sonner";
import { errorMessage } from "../../../shared/errors.ts";
import type {
  MobileShareReach,
  MobileShareState,
  ServerState,
  TailnetAvailability,
} from "../../../shared/ipc.ts";
import { Icon } from "../components/icons.tsx";
import { Button, IconButton } from "../components/ui.tsx";
import { nyte } from "../nyte.ts";
import { keys, useMobileShareState, useServerState } from "../queries.ts";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import { t } from "../theme/vars.stylex.ts";
import { ConnectionList, ConnectionRow, ConnectionStatus } from "./connection-list.tsx";
import { modelsSettingsStyles as styles } from "./models-settings.stylex.ts";
import { PairingCode, pairingPayload } from "./pairing-code.tsx";

const shareStyles = stylex.create({
  panel: { display: "flex", flexDirection: "column", gap: 8 },
  // The pane keeps one height per step and animates between them, so the row
  // below it never jumps while the user switches.
  steps: { display: "grid", overflow: "hidden" },
  step: { gridArea: "1 / 1", display: "flex", flexDirection: "column", gap: 8 },
  switcher: { display: "inline-flex", gap: 2, alignSelf: "flex-start" },
  scan: { display: "flex", alignItems: "center", gap: 12 },
  scanText: { display: "flex", flexDirection: "column", gap: 4, minWidth: 0 },
  // One grid for both fields so the value boxes share a left edge and width.
  fields: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr) auto",
    alignItems: "center",
    columnGap: 8,
    rowGap: 6,
  },
  label: {
    color: t.textSecondary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
  },
  fieldActions: { display: "inline-flex", gap: 2 },
  // Selected whole so a click cannot grab half of a token or address.
  value: {
    boxSizing: "border-box",
    minWidth: 0,
    minHeight: 26,
    paddingInline: 8,
    paddingBlock: 4,
    borderRadius: t.radiusBase,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: t.strokeSecondary,
    backgroundColor: t.bgBase,
    color: t.textPrimary,
    fontFamily: t.fontMono,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    fontVariantNumeric: "tabular-nums",
    userSelect: "all",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
});

function ConnectForm({
  pending,
  onSubmit,
  onCancel,
}: {
  pending: boolean;
  onSubmit: (input: { baseUrl: string; token: string }) => void;
  onCancel: (() => void) | undefined;
}): ReactElement {
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const ready = baseUrl.trim() !== "" && token.trim() !== "";
  return (
    <form
      {...stylex.props(styles.keyForm)}
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) onSubmit({ baseUrl: baseUrl.trim(), token: token.trim() });
      }}
    >
      <div {...stylex.props(styles.keyRow)}>
        <Input
          unstyled
          type="url"
          aria-label="Server URL"
          autoComplete="off"
          autoFocus
          spellCheck={false}
          placeholder="https://nyte-server.example.com"
          value={baseUrl}
          disabled={pending}
          {...stylex.props(styles.keyInput)}
          onChange={(event) => setBaseUrl(event.target.value)}
        />
      </div>
      <div {...stylex.props(styles.keyRow)}>
        <Input
          unstyled
          type="password"
          aria-label="Server token"
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste the server's NYTE_TOKEN"
          value={token}
          disabled={pending}
          {...stylex.props(styles.keyInput)}
          onChange={(event) => setToken(event.target.value)}
        />
        <Button type="submit" variant="primary" disabled={pending || !ready}>
          {pending ? "Connecting…" : "Connect"}
        </Button>
        {onCancel !== undefined && (
          <Button variant="ghost" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      <span {...stylex.props(styles.keyHint)}>
        Stored on this Mac in ~/.nyte/server.json. The desktop proves the token before saving it.
      </span>
    </form>
  );
}

function serverDetail(state: Exclude<ServerState, { kind: "none" }>): string {
  if (state.kind === "unavailable") return state.problem.message;
  const host = state.info.host;
  if (host.kind === "unspecified")
    return "The server responds, but does not report its tools or history storage.";
  const persistence =
    host.persistence === "durable"
      ? "Chat history uses durable storage."
      : host.persistence === "ephemeral"
        ? "Chat history is temporary and can disappear when the server restarts."
        : "The server has not reported how chat history is stored.";
  return `${host.capabilities.workspace ? "Workspace tools available." : "Chat only."} ${persistence}`;
}

export function CloudServerSettings(): ReactElement {
  const client = useQueryClient();
  const server = useServerState();
  const [editing, setEditing] = useState(false);
  const connect = useMutation({
    mutationFn: (input: { baseUrl: string; token: string }) => nyte.host.server.connect(input),
    onSuccess: (outcome) => {
      if (outcome.kind === "failed") {
        toast.error(`Couldn't reach the server: ${outcome.message}`, { id: "server-connect" });
        return;
      }
      setEditing(false);
      toast.success(`Connected to ${outcome.baseUrl} (v${outcome.version})`, {
        id: "server-connect",
      });
    },
    onError: () => toast.error("Couldn't reach the server.", { id: "server-connect" }),
    onSettled: () => client.invalidateQueries({ queryKey: keys.server }),
  });
  const disconnect = useMutation({
    mutationFn: () => nyte.host.server.disconnect(),
    onSettled: () => client.invalidateQueries({ queryKey: keys.server }),
  });
  const state = server.data;
  const pending = connect.isPending || disconnect.isPending;
  const form = (
    <ConnectForm
      pending={connect.isPending}
      onSubmit={(input) => connect.mutate(input)}
      onCancel={state !== undefined && state.kind !== "none" ? () => setEditing(false) : undefined}
    />
  );

  return (
    <section {...stylex.props(settingsPatterns.section)}>
      <div {...stylex.props(settingsPatterns.sectionHeader)}>
        <h2 {...stylex.props(settingsPatterns.sectionTitle)}>Cloud</h2>
        <p {...stylex.props(settingsPatterns.sectionDescription)}>
          A Nyte server you deployed. Its chats appear under Cloud in the sidebar and run with the
          server's keys.
        </p>
      </div>
      <ConnectionList>
        {state === undefined ? (
          <ConnectionRow
            glyph={<Icon name="cloud" size={16} />}
            title="Server"
            detail={undefined}
            status={<ConnectionStatus tone="warn">Checking…</ConnectionStatus>}
          />
        ) : state.kind === "none" ? (
          <ConnectionRow
            glyph={<Icon name="cloud" size={16} />}
            title="Not connected"
            detail="Deploy packages/demo/server, then paste its URL and token."
            expansion={form}
          />
        ) : (
          <ConnectionRow
            glyph={<Icon name="cloud" size={16} />}
            title={state.baseUrl}
            detail={serverDetail(state)}
            status={
              <ConnectionStatus
                tone={server.isFetching ? "warn" : state.kind === "connected" ? "on" : "err"}
              >
                {server.isFetching
                  ? "Checking…"
                  : state.kind === "connected"
                    ? "Connected"
                    : state.problem.kind === "authentication"
                      ? "Access required"
                      : "Unavailable"}
              </ConnectionStatus>
            }
            actions={
              <>
                <Button
                  variant="ghost"
                  disabled={pending || server.isFetching}
                  onClick={() => void server.refetch()}
                >
                  Check connection
                </Button>
                <Button variant="ghost" disabled={pending} onClick={() => setEditing(true)}>
                  Change
                </Button>
                <Button variant="ghost" disabled={pending} onClick={() => disconnect.mutate()}>
                  Disconnect
                </Button>
              </>
            }
            expansion={editing ? form : undefined}
          />
        )}
      </ConnectionList>
    </section>
  );
}

function CopyButton({ label, value }: { label: string; value: string }): ReactElement {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      compact
      icon={copied ? "checkmark" : "copy"}
      label={copied ? "Copied" : `Copy ${label.toLocaleLowerCase()}`}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(
          () => setCopied(true),
          () => {
            setCopied(false);
            toast.error(
              `Couldn't copy the ${label.toLocaleLowerCase()}. Select it and copy it yourself.`,
            );
          },
        );
      }}
    />
  );
}

function shareTargetLabel(
  target: Extract<MobileShareState, { kind: "sharing" }>["target"],
): string {
  return target.kind === "home" ? "Home" : target.workspace.name;
}

/** The address and token the simulator needs, with the token hidden until asked for. */
function SharePanel({ state }: { state: Extract<MobileShareState, { kind: "sharing" }> }) {
  const [revealed, setRevealed] = useState(false);
  const [step, setStep] = useState<"scan" | "details">("scan");
  const reducedMotion = useReducedMotion();
  const transition: Transition =
    reducedMotion === true ? { duration: 0 } : { type: "spring", duration: 0.28, bounce: 0 };
  // Forward and back read as movement in opposite directions.
  const offset = step === "scan" ? -8 : 8;
  const payload = pairingPayload({ address: state.address, token: state.token });

  return (
    <div {...stylex.props(shareStyles.panel)}>
      <div {...stylex.props(shareStyles.switcher)} role="group" aria-label="Pairing method">
        <Button
          variant={step === "scan" ? "primary" : "ghost"}
          aria-pressed={step === "scan"}
          onClick={() => setStep("scan")}
        >
          Scan
        </Button>
        <Button
          variant={step === "details" ? "primary" : "ghost"}
          aria-pressed={step === "details"}
          onClick={() => setStep("details")}
        >
          Address and token
        </Button>
      </div>
      <motion.div layout {...stylex.props(shareStyles.steps)} transition={transition}>
        <AnimatePresence initial={false} mode="popLayout">
          {step === "scan" ? (
            <motion.div
              key="scan"
              layout="position"
              initial={{ opacity: 0, x: offset }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: offset }}
              transition={transition}
              {...stylex.props(shareStyles.step)}
            >
              <div {...stylex.props(shareStyles.scan)}>
                <PairingCode value={payload} size={132} />
                <span {...stylex.props(shareStyles.scanText)}>
                  <span {...stylex.props(shareStyles.label)}>
                    In the iOS app, tap Scan QR code on the connect screen.
                  </span>
                  <span {...stylex.props(styles.deviceCodeNote)}>
                    The code carries this share's token, so treat it like the token itself. It stops
                    working when you stop sharing.
                  </span>
                </span>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="details"
              layout="position"
              initial={{ opacity: 0, x: offset }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: offset }}
              transition={transition}
              {...stylex.props(shareStyles.step)}
            >
              <div {...stylex.props(shareStyles.fields)}>
                <span {...stylex.props(shareStyles.label)}>Address</span>
                <code aria-label="Share address" {...stylex.props(shareStyles.value)}>
                  {state.address}
                </code>
                <span {...stylex.props(shareStyles.fieldActions)}>
                  <CopyButton label="Address" value={state.address} />
                </span>
                <span {...stylex.props(shareStyles.label)}>Token</span>
                <code aria-label="Share token" {...stylex.props(shareStyles.value)}>
                  {revealed ? state.token : "••••••••••••••••"}
                </code>
                <span {...stylex.props(shareStyles.fieldActions)}>
                  <CopyButton label="Token" value={state.token} />
                  <IconButton
                    compact
                    icon="eye"
                    label={revealed ? "Hide token" : "Reveal token"}
                    aria-pressed={revealed}
                    onClick={() => setRevealed((value) => !value)}
                  />
                </span>
              </div>
              <span {...stylex.props(styles.deviceCodeNote)}>
                {state.reach === "tailnet"
                  ? "Enter these in the iOS app. Reachable from your signed-in Tailscale devices on any network, and from nothing else. The token is new for every share and never written to disk."
                  : "Enter these in the iOS app. Loopback only, so a physical phone can't reach it. The token is new for every share and never written to disk."}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

function tailnetDetail(tailnet: TailnetAvailability): string {
  if (tailnet.kind === "missing") return "Tailscale isn't installed on this Mac.";
  if (tailnet.kind === "unavailable") return "Tailscale isn't running. Start it, then share again.";
  return `Reachable at ${tailnet.name ?? tailnet.ip} from your signed-in devices, on any network.`;
}

function MobileShareSettings(): ReactElement {
  const client = useQueryClient();
  const share = useMobileShareState();
  const start = useMutation({
    mutationFn: (reach: MobileShareReach) => nyte.host.mobile.start({ reach }),
    onError: (cause) =>
      toast.error(`Couldn't start sharing: ${errorMessage(cause)}`, { id: "mobile-share" }),
    onSettled: () => client.invalidateQueries({ queryKey: keys.mobileShare }),
  });
  const stop = useMutation({
    mutationFn: () => nyte.host.mobile.stop(),
    onError: (cause) =>
      toast.error(`Couldn't stop sharing: ${errorMessage(cause)}`, { id: "mobile-share" }),
    onSettled: () => client.invalidateQueries({ queryKey: keys.mobileShare }),
  });
  const state = share.data;
  const pending = start.isPending || stop.isPending;

  return (
    <section {...stylex.props(settingsPatterns.section)}>
      <div {...stylex.props(settingsPatterns.sectionHeader)}>
        <h2 {...stylex.props(settingsPatterns.sectionTitle)}>iOS app</h2>
        <p {...stylex.props(settingsPatterns.sectionDescription)}>
          Serve the selected folder's chats to the Nyte iOS app. The phone sees the same
          conversations; runs still execute here.
        </p>
      </div>
      <ConnectionList>
        {state === undefined ? null : state.kind === "off" ? (
          <>
            <ConnectionRow
              glyph={<Icon name="phone" size={16} />}
              title="Simulator on this Mac"
              detail="Loopback only. Keeps serving the folder selected now, even after you switch folders."
              actions={
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() => start.mutate("simulator")}
                >
                  {start.isPending && start.variables === "simulator"
                    ? "Starting…"
                    : "Start sharing"}
                </Button>
              }
            />
            <ConnectionRow
              glyph={<Icon name="phone" size={16} />}
              title="Over Tailscale"
              detail={tailnetDetail(state.tailnet)}
              actions={
                <Button
                  variant="primary"
                  disabled={pending || state.tailnet.kind !== "ready"}
                  onClick={() => start.mutate("tailnet")}
                >
                  {start.isPending && start.variables === "tailnet" ? "Starting…" : "Start sharing"}
                </Button>
              }
            />
          </>
        ) : (
          <ConnectionRow
            glyph={<Icon name="phone" size={16} />}
            title={`Sharing ${shareTargetLabel(state.target)}`}
            detail={state.target.kind === "home" ? undefined : state.target.workspace.path}
            status={
              <ConnectionStatus tone="on">
                {state.reach === "tailnet" ? "Serving over Tailscale" : "Serving to simulator"}
              </ConnectionStatus>
            }
            actions={
              <Button variant="ghost" disabled={pending} onClick={() => stop.mutate()}>
                {stop.isPending ? "Stopping…" : "Stop sharing"}
              </Button>
            }
            expansion={<SharePanel state={state} />}
          />
        )}
      </ConnectionList>
    </section>
  );
}

export function ServerSettings(): ReactElement {
  return (
    <>
      <CloudServerSettings />
      <MobileShareSettings />
    </>
  );
}
