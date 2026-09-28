/**
 * The two connections Environments shows, pointing opposite ways. The Cloud
 * row is outbound: a remote Nyte host this desktop reaches, whose chats run
 * with the server's keys. Remote access is inbound: this desktop serving one
 * of its own local stores, with the web app on the same address, to a browser
 * or the iOS app on this Mac or over Tailscale. Nothing here touches local
 * providers.
 */
import * as stylex from "@stylexjs/stylex";
import { focusManager, useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Transition } from "motion/react";
import { useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { toast } from "@nyte-ai/ui/toast";
import { errorMessage } from "../errors.ts";
import type {
  RemoteAccessState,
  RemoteReach,
  ServerState,
  TailnetAvailability,
} from "../bridge.ts";
import { Icon } from "@nyte-ai/ui/icon";
import { Button } from "@nyte-ai/ui/button";
import { Input } from "@nyte-ai/ui/input";
import { Toggle } from "@nyte-ai/ui/toggle";
import { nyte } from "../nyte.ts";
import { keys, useRemoteAccessState, useServerState } from "../queries.ts";
import { t } from "@nyte-ai/ui/vars.stylex";
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
    backgroundColor: t.bgPage,
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
          variant="quiet"
          size="sm"
          type="url"
          aria-label="Server URL"
          autoComplete="off"
          autoFocus
          spellCheck={false}
          placeholder="https://nyte-server.example.com"
          value={baseUrl}
          disabled={pending}
          xstyle={styles.keyInput}
          onValueChange={setBaseUrl}
        />
      </div>
      <div {...stylex.props(styles.keyRow)}>
        <Input
          variant="quiet"
          size="sm"
          type="password"
          aria-label="Server token"
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste the server's NYTE_TOKEN"
          value={token}
          disabled={pending}
          xstyle={styles.keyInput}
          onValueChange={setToken}
        />
        <Button type="submit" variant="inverse" disabled={pending || !ready}>
          {pending ? "Connecting…" : "Connect"}
        </Button>
        {onCancel !== undefined && (
          <Button disabled={pending} onClick={onCancel}>
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

export function CloudConnection({ active }: { readonly active: boolean }): ReactElement {
  const client = useQueryClient();
  const server = useServerState(active);
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
    <>
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
              <Button disabled={pending || server.isFetching} onClick={() => void server.refetch()}>
                Check connection
              </Button>
              <Button disabled={pending} onClick={() => setEditing(true)}>
                Change
              </Button>
              <Button disabled={pending} onClick={() => disconnect.mutate()}>
                Disconnect
              </Button>
            </>
          }
          expansion={editing ? form : undefined}
        />
      )}
    </>
  );
}

function CopyButton({ label, value }: { label: string; value: string }): ReactElement {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      size="icon"
      icon={copied ? "checkmark" : "copy"}
      aria-label={copied ? "Copied" : `Copy ${label.toLocaleLowerCase()}`}
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

type Serving = Extract<RemoteAccessState, { kind: "serving" }>;

function servedTargetLabel(target: Serving["target"]): string {
  return target.kind === "home" ? "Home" : target.workspace.name;
}

/** The link, address, and token a client needs, with the token hidden until asked for. */
function ServingPanel({ state }: { state: Serving }) {
  const [revealed, setRevealed] = useState(false);
  const [step, setStep] = useState<"scan" | "details">("scan");
  const reducedMotion = useReducedMotion();

  const transition: Transition =
    reducedMotion === true ? { duration: 0 } : { type: "spring", duration: 0.28, bounce: 0 };

  // Forward and back read as movement in opposite directions.
  const offset = step === "scan" ? -8 : 8;
  const payload = pairingPayload({ address: state.address, token: state.token });

  const hidden = "••••••••••••••••";

  return (
    <div {...stylex.props(shareStyles.panel)}>
      <div {...stylex.props(shareStyles.fields)}>
        <span {...stylex.props(shareStyles.label)}>Link</span>
        <code aria-label="Pairing link" {...stylex.props(shareStyles.value)}>
          {revealed ? state.pairingUrl : state.pairingUrl.replace(state.token, hidden)}
        </code>
        <span {...stylex.props(shareStyles.fieldActions)}>
          <CopyButton label="Link" value={state.pairingUrl} />
          <Button
            onClick={() => {
              nyte.host.openExternal({ url: state.pairingUrl }).catch((cause: unknown) => {
                toast.error(`Couldn't open the link: ${errorMessage(cause)}`);
              });
            }}
          >
            Open
          </Button>
        </span>
      </div>
      <div {...stylex.props(shareStyles.switcher)} role="group" aria-label="Pairing method">
        <Toggle pressed={step === "scan"} onPressedChange={() => setStep("scan")}>
          Scan
        </Toggle>
        <Toggle pressed={step === "details"} onPressedChange={() => setStep("details")}>
          Address and token
        </Toggle>
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
                    The code carries the token, so treat it like the token itself. It stops working
                    when you stop.
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
                <code aria-label="Address" {...stylex.props(shareStyles.value)}>
                  {state.address}
                </code>
                <span {...stylex.props(shareStyles.fieldActions)}>
                  <CopyButton label="Address" value={state.address} />
                </span>
                <span {...stylex.props(shareStyles.label)}>Token</span>
                <code aria-label="Token" {...stylex.props(shareStyles.value)}>
                  {revealed ? state.token : hidden}
                </code>
                <span {...stylex.props(shareStyles.fieldActions)}>
                  <CopyButton label="Token" value={state.token} />
                  <Button
                    size="icon"
                    icon="eye"
                    aria-label={revealed ? "Hide token" : "Reveal token"}
                    aria-pressed={revealed}
                    onClick={() => setRevealed((value) => !value)}
                  />
                </span>
              </div>
              <span {...stylex.props(styles.deviceCodeNote)}>
                {state.reach === "tailnet"
                  ? "Reachable from your signed-in Tailscale devices on any network, and from nothing else. The token is new each time and never written to disk."
                  : "Only this Mac can reach this address, so a physical phone can't. The token is new each time and never written to disk."}
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

  if (tailnet.kind === "unavailable") return "Tailscale isn't running. Start it, then try again.";

  return `Reachable at ${tailnet.name ?? tailnet.ip} from your signed-in devices, on any network.`;
}

export function RemoteAccess({ active }: { readonly active: boolean }): ReactElement {
  const client = useQueryClient();
  const remote = useRemoteAccessState(active);

  const start = useMutation({
    mutationFn: (reach: RemoteReach) => nyte.host.remote.start({ reach }),
    onError: (cause) =>
      toast.error(`Couldn't start remote access: ${errorMessage(cause)}`, {
        id: "remote-access",
      }),
    onSettled: () => client.invalidateQueries({ queryKey: keys.remoteAccess }),
  });

  const stop = useMutation({
    mutationFn: () => nyte.host.remote.stop(),
    onError: (cause) =>
      toast.error(`Couldn't stop remote access: ${errorMessage(cause)}`, {
        id: "remote-access",
      }),
    onSettled: () => client.invalidateQueries({ queryKey: keys.remoteAccess }),
  });

  const state = remote.data;
  const pending = start.isPending || stop.isPending;

  return (
    <ConnectionList>
      {state === undefined ? null : state.kind === "off" ? (
        <>
          <ConnectionRow
            glyph={<Icon name="computer" size={16} />}
            title="This Mac only"
            detail="Serves the selected folder. Switching folders here afterwards doesn't move it; a connected client can."
            actions={
              <Button disabled={pending} onClick={() => start.mutate("local")}>
                {start.isPending && start.variables === "local" ? "Starting…" : "Start"}
              </Button>
            }
          />
          <ConnectionRow
            glyph={<Icon name="devices" size={16} />}
            title="Over Tailscale"
            detail={tailnetDetail(state.tailnet)}
            actions={
              <Button
                variant="inverse"
                disabled={pending || state.tailnet.kind !== "ready"}
                onClick={() => start.mutate("tailnet")}
              >
                {start.isPending && start.variables === "tailnet" ? "Starting…" : "Start"}
              </Button>
            }
          />
        </>
      ) : (
        <ConnectionRow
          glyph={<Icon name={state.reach === "tailnet" ? "devices" : "computer"} size={16} />}
          title={`Serving ${servedTargetLabel(state.target)}`}
          detail={state.target.kind === "home" ? undefined : state.target.workspace.path}
          status={
            <ConnectionStatus tone="on">
              {state.reach === "tailnet" ? "Over Tailscale" : "This Mac only"}
            </ConnectionStatus>
          }
          actions={
            <Button disabled={pending} onClick={() => stop.mutate()}>
              {stop.isPending ? "Stopping…" : "Stop"}
            </Button>
          }
          expansion={<ServingPanel state={state} />}
        />
      )}
    </ConnectionList>
  );
}

const subscribeToWindowFocus = (notify: () => void): (() => void) => focusManager.subscribe(notify);

const readWindowFocus = (): boolean => focusManager.isFocused();

/** Connection state is polled only while the window has focus. */
export function useWindowFocused(): boolean {
  return useSyncExternalStore(subscribeToWindowFocus, readWindowFocus, readWindowFocus);
}
