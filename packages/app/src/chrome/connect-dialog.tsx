/**
 * Nyte account remote access, embedded the way a wallet kit embeds its
 * connect flow: `ConnectButton` is a compact chip that says where things
 * stand, and `ConnectDialog` is the one place to sign in, link this Mac, turn
 * remote access on, manage devices, and unlink. The desktop renders Clerk's
 * sign-in dialog in the same window.
 * The link's owner can differ from the account signed in here, so the two are
 * always shown apart.
 */
import { srOnly } from "@nyte-ai/ui/a11y.stylex";
import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@nyte-ai/ui/avatar";
import { Button } from "@nyte-ai/ui/button";
import { Dialog } from "@nyte-ai/ui/dialog";
import { Icon } from "@nyte-ai/ui/icon";
import { row, radius } from "@nyte-ai/ui/schema.stylex";
import { Spinner } from "@nyte-ai/ui/spinner";
import { SwitchField } from "@nyte-ai/ui/switch";
import { intent } from "@nyte-ai/ui/surface-theme";
import { toast } from "@nyte-ai/ui/toast";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { create, props } from "@stylexjs/stylex";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { ReactElement } from "react";
import type {
  ConnectAccount,
  ConnectBridge,
  ConnectLinkFailure,
  ConnectNotice,
  ConnectUnavailable,
  ConnectView,
} from "../bridge.ts";
import { errorMessage } from "../errors.ts";
import { keys } from "../queries.ts";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import { ConnectionStatus } from "./connection-list.tsx";

const styles = create({
  identity: { display: "flex", alignItems: "center", gap: 12 },
  identityText: { display: "flex", flexDirection: "column", gap: 2, flexGrow: 1, minWidth: 0 },
  wrap: { overflowWrap: "anywhere" },
  section: { display: "flex", flexDirection: "column", gap: 6 },
  list: { margin: 0, padding: 0, listStyle: "none" },
  item: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: row.heightMd,
    paddingInline: 12,
    paddingBlock: 6,
  },
  itemText: { display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0 },
  primary: {
    color: role.contentPrimary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    overflowWrap: "anywhere",
  },
  note: {
    margin: 0,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    textWrap: "pretty",
  },
  secondary: { color: role.contentSecondary, fontSize: type.fontSm, lineHeight: type.leadingSm },
  unlink: { marginInlineEnd: "auto" },
  badged: { position: "relative", display: "inline-flex" },
  badge: {
    position: "absolute",
    insetBlockStart: 0,
    insetInlineEnd: 0,
    width: 6,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: role.contentSecondary,
  },
});

type Linked = Extract<ConnectView, { kind: "linked" }>;

type Unlinked = Extract<ConnectView, { kind: "unlinked" }>;

type Tone = Parameters<typeof ConnectionStatus>[0]["tone"];

interface Standing {
  readonly tone: Tone;
  readonly label: string;
  readonly note: string | undefined;
}

function useConnectView(connect: ConnectBridge, active: boolean) {
  return useQuery({
    queryKey: keys.connect,
    queryFn: () => connect.state(),
    enabled: active,
    staleTime: 0,
    refetchOnWindowFocus: "always",
    refetchOnMount: "always",
  });
}

function useConnectAction<TInput = void, TResult = void>(
  act: (input: TInput) => Promise<TResult>,
  failure: string,
) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: act,
    onError: (cause) =>
      toast.add({ type: "error", title: `${failure}: ${errorMessage(cause)}`, id: "nyte-account" }),
    onSettled: () => client.invalidateQueries({ queryKey: keys.connect }),
  });
}

function unavailableDetail(reason: ConnectUnavailable): string {
  switch (reason) {
    case "not_configured":
      return "This build of Nyte isn’t set up for Nyte accounts.";
    case "store_failed":
      return "Nyte can’t read or write ~/.nyte/connect.json. Fix or remove it, then restart Nyte.";
    case "keychain_unavailable":
      return "Nyte can’t use the macOS Keychain to protect this Mac’s key.";
    default: {
      const _exhaustive: never = reason;

      return _exhaustive;
    }
  }
}

function noticeNote(notice: ConnectNotice): string | undefined {
  switch (notice.kind) {
    case "none":
      return undefined;
    case "revoked":
      return "This Mac was removed from your Nyte account.";
    case "unlink_pending":
      return "Unlinked. Your account lists this Mac until Nyte reaches it.";
    default: {
      const _exhaustive: never = notice;

      return _exhaustive;
    }
  }
}

function linkFailure(reason: ConnectLinkFailure): string | undefined {
  switch (reason) {
    case "cancelled":
      return undefined;
    case "network":
      return "Couldn’t reach Nyte. Check your internet connection, then try again.";
    case "limit":
      return "This account can’t link another Mac right now. Try again later, or unlink a Mac you no longer use.";
    case "owner_disabled":
      return "This Nyte account is locked or disabled, so it can’t link Macs.";
    case "session_revoked":
      return "Your sign-in was revoked. Sign in again, then link this Mac.";
    case "refused":
      return "Nyte refused to link this Mac.";
    default: {
      const _exhaustive: never = reason;

      return _exhaustive;
    }
  }
}

/**
 * Only a current lease admits devices, so nothing short of one reads as
 * reachable, however connected the relay is.
 */
function linkedStanding(view: Linked): Standing {
  if (!view.enabled) return { tone: "off", label: "Off", note: undefined };

  if (view.connection.kind === "failed") {
    return {
      tone: "err",
      label: "Not reachable",
      note: "Another Nyte connection replaced this Mac. Turn remote access off, then on again.",
    };
  }

  switch (view.lease.kind) {
    case "stopped":
      return { tone: "off", label: "Stopped", note: undefined };
    case "pending":
      return { tone: "warn", label: "Verifying…", note: undefined };
    case "lapsed":
      return view.lease.reason === "owner_disabled"
        ? {
            tone: "err",
            label: "Account disabled",
            note: `${view.owner.label} is locked or disabled, so devices are refused.`,
          }
        : {
            tone: "warn",
            label: "Offline",
            note: "Nyte can’t reach your account to verify this Mac, so devices are refused until it does.",
          };
    case "current":
      switch (view.connection.kind) {
        case "stopped":
          return { tone: "off", label: "Stopped", note: undefined };
        case "connecting":
          return { tone: "warn", label: "Connecting…", note: undefined };
        case "retrying":
          return { tone: "warn", label: "Reconnecting…", note: undefined };
        case "connected":
          return { tone: "on", label: "Reachable", note: undefined };
        default: {
          const _exhaustive: never = view.connection;

          return _exhaustive;
        }
      }

    default: {
      const _exhaustive: never = view.lease;

      return _exhaustive;
    }
  }
}

const graphemes = new Intl.Segmenter();

function initial(label: string): string {
  return graphemes.segment(label.trim()).containing(0)?.segment.toLocaleUpperCase() ?? "";
}

function AccountAvatar({ label, size }: { label: string; size: "xs" | "lg" }): ReactElement {
  return (
    <Avatar size={size} tone="blue" aria-hidden="true">
      <AvatarFallback>{initial(label)}</AvatarFallback>
    </Avatar>
  );
}

function UnavailableBody({ reason }: { reason: ConnectUnavailable }): ReactElement {
  return (
    <>
      <Dialog.Header>
        <Dialog.Title>Nyte Account</Dialog.Title>
        <Dialog.Description>{unavailableDetail(reason)}</Dialog.Description>
      </Dialog.Header>
      <Dialog.Footer>
        <Dialog.Close render={<Button variant="outline">Close</Button>} />
      </Dialog.Footer>
    </>
  );
}

/** The account signed in on this Mac, which a link's owner need not be. */
function SignedInAccount({
  account,
  connect,
  caption,
}: {
  account: Extract<ConnectAccount, { kind: "signed_in" }>;
  connect: ConnectBridge;
  caption: string | undefined;
}): ReactElement {
  const signOut = useConnectAction(() => connect.signOut(), "Couldn’t sign out");

  return (
    <div {...props(settingsPatterns.group, styles.item)}>
      <span {...props(styles.itemText)}>
        <span {...props(styles.primary)}>{account.label}</span>
        {caption !== undefined && <span {...props(styles.secondary)}>{caption}</span>}
      </span>
      <Button loading={signOut.isPending} onClick={() => signOut.mutate()}>
        Sign Out
      </Button>
    </div>
  );
}

function UnlinkedBody({ view, connect }: { view: Unlinked; connect: ConnectBridge }): ReactElement {
  const link = useConnectAction(() => connect.link(), "Couldn’t link this Mac");
  const cancel = useConnectAction(() => connect.cancel(), "Couldn’t stop linking");
  const openAccount = useConnectAction(() => connect.openAccount(), "Couldn’t open your account");
  const { account, linking } = view;
  const notice = noticeNote(view.notice);
  const failure = linking.kind === "failed" ? linkFailure(linking.reason) : undefined;
  const busy = linking.kind === "waiting_for_account" || linking.kind === "linking";

  return (
    <>
      <Dialog.Header>
        <Dialog.Title>Link This Mac</Dialog.Title>
        <Dialog.Description>
          Reach this Mac from the Nyte iOS app on any network.
        </Dialog.Description>
      </Dialog.Header>
      {notice !== undefined && <p {...props(styles.note)}>{notice}</p>}
      {failure !== undefined && (
        <p role="alert" {...props(intent.danger, styles.note)}>
          {failure}
        </p>
      )}
      {busy && (
        <div {...props(settingsPatterns.group, styles.item)}>
          <Spinner />
          <span role="status" {...props(styles.itemText, styles.primary)}>
            {linking.kind === "linking" ? "Linking this Mac…" : "Waiting for sign-in…"}
          </span>
          {linking.kind === "waiting_for_account" && (
            <Button loading={openAccount.isPending} onClick={() => openAccount.mutate()}>
              Sign In
            </Button>
          )}
        </div>
      )}
      {account.kind === "signed_in" && !busy && (
        <SignedInAccount
          account={account}
          connect={connect}
          caption="This Mac links to this account."
        />
      )}
      <Dialog.Footer>
        {busy ? (
          <Button variant="outline" loading={cancel.isPending} onClick={() => cancel.mutate()}>
            Cancel
          </Button>
        ) : (
          <>
            <Dialog.Close render={<Button variant="outline">Not Now</Button>} />
            <Button
              variant="solid"
              tone="primary"
              loading={link.isPending}
              onClick={() => link.mutate()}
            >
              {account.kind === "signed_in" ? "Link This Mac" : "Sign In and Link…"}
            </Button>
          </>
        )}
      </Dialog.Footer>
    </>
  );
}

function LinkedBody({ view, connect }: { view: Linked; connect: ConnectBridge }): ReactElement {
  const [confirming, setConfirming] = useState(false);
  const unlinkRef = useRef<HTMLButtonElement>(null);
  const openAccount = useConnectAction(() => connect.openAccount(), "Couldn’t open your account");

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
  const { account, owner } = view;

  return (
    <>
      <div {...props(styles.identity)}>
        <AccountAvatar label={owner.label} size="lg" />
        <div {...props(styles.identityText)}>
          <Dialog.Title xstyle={styles.wrap}>{owner.label}</Dialog.Title>
          <Dialog.Description>{`This Mac is linked as ${view.environment.name}.`}</Dialog.Description>
        </div>
        <ConnectionStatus tone={standing.tone}>{standing.label}</ConnectionStatus>
      </div>
      <div {...props(styles.section)}>
        <div {...props(settingsPatterns.group)}>
          <SwitchField
            xstyle={styles.item}
            label="Remote Access"
            description="Devices on this account reach this Mac while Nyte is running."
            checked={setEnabled.isPending ? setEnabled.variables : view.enabled}
            disabled={setEnabled.isPending}
            onCheckedChange={(enabled) => setEnabled.mutate(enabled)}
          />
        </div>
        {standing.note !== undefined && <p {...props(styles.note)}>{standing.note}</p>}
      </div>
      <section {...props(styles.section)}>
        <h3 {...props(settingsPatterns.sectionTitle)}>Devices</h3>
        {view.devices.length === 0 ? (
          <p {...props(styles.note)}>
            {`No devices yet. Sign in to the Nyte iOS app as ${owner.label} to add one.`}
          </p>
        ) : (
          <ul {...props(settingsPatterns.group, styles.list)}>
            {view.devices.map((device) => (
              <li key={device.id} {...props(styles.item)}>
                <span {...props(styles.itemText)}>
                  <span {...props(styles.primary)}>{device.name}</span>
                  {view.lease.kind === "current" && !device.authorized && (
                    <span {...props(styles.secondary)}>Not authorized yet</span>
                  )}
                </span>
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
      </section>
      {account.kind !== "unavailable" && (
        <section {...props(styles.section)}>
          <h3 {...props(settingsPatterns.sectionTitle)}>Signed in on this Mac</h3>
          {account.kind === "signed_in" ? (
            <SignedInAccount account={account} connect={connect} caption={undefined} />
          ) : (
            <div {...props(settingsPatterns.group, styles.item)}>
              <span {...props(styles.itemText, styles.primary)}>Not signed in</span>
              <Button loading={openAccount.isPending} onClick={() => openAccount.mutate()}>
                Sign In…
              </Button>
            </div>
          )}
        </section>
      )}
      <Dialog.Footer>
        <Button
          ref={unlinkRef}
          tone="danger"
          xstyle={styles.unlink}
          onClick={() => setConfirming(true)}
        >
          Unlink This Mac…
        </Button>
        <Dialog.Close render={<Button variant="outline">Done</Button>} />
      </Dialog.Footer>
      <ConfirmDialog
        open={confirming}
        pending={unlink.isPending}
        finalFocus={unlinkRef}
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

/** The whole account flow in one dialog. It reads the view itself, so anything can open it. */
export function ConnectDialog({
  connect,
  open,
  onOpenChange,
}: {
  readonly connect: ConnectBridge;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): ReactElement {
  const state = useConnectView(connect, open);
  const view = state.data;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Popup>
        {view === undefined ? (
          <Dialog.Header>
            <Dialog.Title>Nyte Account</Dialog.Title>
            {state.isError ? (
              <Dialog.Description>{errorMessage(state.error)}</Dialog.Description>
            ) : (
              <Spinner />
            )}
          </Dialog.Header>
        ) : view.kind === "unavailable" ? (
          <UnavailableBody reason={view.reason} />
        ) : view.kind === "unlinked" ? (
          <UnlinkedBody view={view} connect={connect} />
        ) : (
          <LinkedBody view={view} connect={connect} />
        )}
      </Dialog.Popup>
    </Dialog.Root>
  );
}

function ChipTrigger({ view, onOpen }: { view: ConnectView; onOpen: () => void }): ReactElement {
  const name = <span {...props(srOnly)}>Nyte account: </span>;

  switch (view.kind) {
    case "unavailable":
      return (
        <Button variant="outline" onClick={onOpen}>
          {name}
          <ConnectionStatus tone={view.reason === "not_configured" ? "off" : "err"}>
            Unavailable
          </ConnectionStatus>
        </Button>
      );
    case "unlinked":
      return view.linking.kind === "waiting_for_account" || view.linking.kind === "linking" ? (
        <Button variant="outline" onClick={onOpen}>
          {name}
          <Spinner />
          Linking…
        </Button>
      ) : (
        <Button variant="solid" tone="primary" onClick={onOpen}>
          Link This Mac…
        </Button>
      );
    case "linked": {
      const standing = linkedStanding(view);

      return (
        <Button variant="outline" onClick={onOpen}>
          <AccountAvatar label={view.owner.label} size="xs" />
          {name}
          <ConnectionStatus tone={standing.tone}>{standing.label}</ConnectionStatus>
        </Button>
      );
    }

    default: {
      const _exhaustive: never = view;

      return _exhaustive;
    }
  }
}

/** One glyph for tight places: a phone, badged with the status once linked. */
function CompactTrigger({
  view,
  onOpen,
}: {
  view: Exclude<ConnectView, { kind: "unavailable" }>;
  onOpen: () => void;
}): ReactElement {
  if (view.kind === "unlinked") {
    return view.linking.kind === "waiting_for_account" || view.linking.kind === "linking" ? (
      <Button iconOnly aria-label="Nyte account: Linking…" onClick={onOpen}>
        <Spinner />
      </Button>
    ) : (
      <Button iconOnly icon="phone" aria-label="Link This Mac…" onClick={onOpen} />
    );
  }

  const { tone, label } = linkedStanding(view);

  return (
    <Button iconOnly aria-label={`Nyte account: ${label}`} onClick={onOpen}>
      <span {...props(styles.badged)}>
        <Icon name="phone" size={16} />
        <span
          aria-hidden="true"
          {...props(
            tone === "on" && intent.success,
            tone === "warn" && intent.warning,
            tone === "err" && intent.danger,
            styles.badge,
          )}
        />
      </span>
    </Button>
  );
}

/**
 * The entry point. The chip names where things stand; `compact` is a single
 * glyph that hides when this build has no account service, leaving the
 * reason to Settings. Either opens the dialog.
 */
export function ConnectButton({
  connect,
  active,
  compact = false,
}: {
  readonly connect: ConnectBridge;
  readonly active: boolean;
  readonly compact?: boolean;
}): ReactElement | null {
  const [open, setOpen] = useState(false);
  const state = useConnectView(connect, active);
  const view = state.data;

  if (view === undefined) {
    if (compact || !state.isError) return null;

    return (
      <Button variant="outline" disabled disabledReason={errorMessage(state.error)}>
        Unavailable
      </Button>
    );
  }

  const show = () => setOpen(true);

  const trigger = !compact ? (
    <ChipTrigger view={view} onOpen={show} />
  ) : view.kind === "unavailable" ? undefined : (
    <CompactTrigger view={view} onOpen={show} />
  );

  if (trigger === undefined) return null;

  return (
    <>
      {trigger}
      <ConnectDialog connect={connect} open={open} onOpenChange={setOpen} />
    </>
  );
}
