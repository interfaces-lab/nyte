import { useRef, useState } from "react";
import { ActivityIndicator, Alert, Modal, ScrollView } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { SymbolView } from "expo-symbols";
import { css, html } from "react-strict-dom";
import { BrokerError } from "@nyte-ai/connect";
import type { BrokerClient, EnvironmentSummary } from "@nyte-ai/connect";
import { displayAddress, type SavedConnection } from "../connection/connection.ts";
import { SHARE_LOCATION } from "../connection/connect-copy.ts";
import { GlassButton } from "../ui/glass-button.tsx";
import { Group, GroupRow } from "../ui/group.tsx";
import { IconTile } from "../ui/icon-tile.tsx";
import { SectionHeader } from "../ui/section-header.tsx";
import { toast } from "../ui/toast.tsx";
import { useMountEffect } from "../use-mount-effect.ts";
import { ConnectionForm } from "../connection/connection-form.tsx";
import { controls, list, spacing, textStyles, tokens, useTheme } from "../theme.ts";
import { brokerCopy, connectEndingCopy, releaseCopy, type AccountCopy } from "./account-copy.ts";
import type { Account, SignInEnding, SignOutEnding } from "./account-provider.tsx";

type Current = { readonly saved: SavedConnection; readonly reconnect: boolean };

export function ConnectPanel({
  account,
  current,
  manual,
  welcome = false,
}: {
  account: Account;
  current: Current | undefined;
  manual?: { readonly onPress: () => void; readonly label: string };
  welcome?: boolean;
}) {
  const theme = useTheme();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<AccountCopy>();
  const { status } = account;

  async function signIn(renew: boolean) {
    setBusy(true);
    setNotice(undefined);
    const ending = await (renew ? account.renew() : account.signIn());
    setBusy(false);
    setNotice(signInNotice(ending));
  }

  async function signOut() {
    setBusy(true);
    setNotice(undefined);
    const ending = await account.signOut();
    setBusy(false);
    setNotice(signOutNotice(ending));
  }

  function confirmSignOut() {
    const owned =
      current?.saved.kind === "managed" &&
      status.kind === "signedIn" &&
      current.saved.binding.ownerId === status.ownerId
        ? current.saved.connection.name
        : undefined;

    Alert.alert(
      "Sign Out of Nyte",
      owned === undefined ? undefined : `This iPhone disconnects from ${owned}.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Sign Out", style: "destructive", onPress: () => void signOut() },
      ],
    );
  }

  return (
    <html.div style={styles.panel}>
      {welcome && status.kind !== "signedIn" ? null : <SectionHeader label="Nyte account" first />}
      {status.kind === "loading" ? (
        <Group>
          <GroupRow>
            <ActivityIndicator color={theme.muted} />
            <html.span style={textStyles.caption}>Checking your Nyte account…</html.span>
          </GroupRow>
        </Group>
      ) : status.kind === "signedOut" ? (
        <html.div style={styles.inset}>
          <GlassButton
            label={busy ? "Signing in…" : "Sign in to Nyte"}
            systemImage={welcome ? undefined : "person.crop.circle.fill"}
            busy={busy}
            prominent
            fill
            onPress={() => void signIn(false)}
          />
        </html.div>
      ) : (
        <html.div style={styles.profileGroup}>
          <Group>
            <GroupRow>
              <AccountAvatar key={status.avatarUrl} url={status.avatarUrl} size={48} />
              <html.span style={[textStyles.headline, styles.profileLabel]}>
                {status.label}
              </html.span>
            </GroupRow>
          </Group>
          <Group>
            <GroupRow busy={busy} onClick={() => void signIn(true)}>
              <IconTile name="arrow.left.arrow.right" />
              <html.span style={textStyles.body}>Switch Account</html.span>
            </GroupRow>
            <GroupRow busy={busy} onClick={confirmSignOut}>
              <IconTile name="rectangle.portrait.and.arrow.right" color={theme.danger} />
              <html.span style={[textStyles.body, styles.danger]}>Sign Out</html.span>
            </GroupRow>
          </Group>
        </html.div>
      )}
      {notice === undefined ? null : <Notice copy={notice} />}
      {status.kind === "signedIn" ? (
        <MacGroup
          key={status.ownerId}
          account={account}
          ownerId={status.ownerId}
          broker={status.broker}
          current={current}
          onRenew={() => void signIn(true)}
        />
      ) : null}
      {manual === undefined ? null : (
        <>
          <SectionHeader label="Direct connection" />
          <Group>
            <GroupRow onClick={manual.onPress}>
              <IconTile name="network" />
              <html.span style={[textStyles.body, styles.grow]}>{manual.label}</html.span>
              <SymbolView
                name="chevron.right"
                size={controls.iconXs}
                weight="semibold"
                tintColor={theme.interactiveTertiary}
              />
            </GroupRow>
          </Group>
        </>
      )}
    </html.div>
  );
}

function signInNotice(ending: SignInEnding): AccountCopy | undefined {
  switch (ending.kind) {
    case "signedIn":
    case "cancelled":
      return undefined;
    case "unavailable":
      return {
        title: "Nyte sign-in isn't ready",
        body: "Check that this phone is online, then try again.",
        action: "retry",
      };
    case "unregisteredApp":
      return {
        title: "Sign-in unavailable",
        body: "This version of Nyte hasn't been registered for sign-in. Connect with Tailscale or a QR code.",
        action: undefined,
      };
    case "failed":
      return { title: "Couldn't sign in", body: "Try signing in again.", action: "retry" };
    default: {
      const exhaustive: never = ending;

      return exhaustive;
    }
  }
}

export function AccountAvatar({ url, size = 36 }: { url: string | undefined; size?: number }) {
  const theme = useTheme();
  const [unavailable, setUnavailable] = useState(false);

  return (
    <html.div aria-hidden style={styles.avatar(size)}>
      {url === undefined || unavailable ? (
        <SymbolView name="person" size={size * 0.65} tintColor={theme.foreground} />
      ) : (
        <html.img
          alt=""
          src={url}
          style={styles.avatarImage(size)}
          onError={() => setUnavailable(true)}
        />
      )}
    </html.div>
  );
}

function signOutNotice(ending: SignOutEnding): AccountCopy | undefined {
  if (ending.kind === "notRemoved")
    return {
      title: "Still signed in",
      body: "The Keychain kept this computer's connection. Unlock your phone and try again.",
      action: "retry",
    };

  if (ending.released !== undefined)
    toast.show("Signed out", releaseCopy(ending.released.name, ending.released.report));
  else if (ending.kind === "signedOut") toast.show("Signed out");

  return ending.kind === "clerkFailed"
    ? {
        title: "Couldn't finish signing out",
        body: "Nyte didn't end this sign-in. Check that this phone is online, then sign out again.",
        action: "retry",
      }
    : undefined;
}

/**
 * The owner's Macs from the broker, with connect and repair. The list is keyed by owner and dropped on
 * any account change, and holds ids and names only, never a credential. A refusal that says the list
 * was out of date (forbidden, not found, revoked) refetches it to show what the broker has now.
 */
function MacGroup({
  account,
  ownerId,
  broker,
  current,
  onRenew,
}: {
  account: Account;
  ownerId: string;
  broker: BrokerClient;
  current: Current | undefined;
  onRenew: () => void;
}) {
  const theme = useTheme();
  const environments = useQuery(
    {
      queryKey: ["account", ownerId, "environments"],
      queryFn: ({ signal }) => broker.listEnvironments({ signal }),
      retry: false,
    },
    account.queryClient,
  );
  const [connecting, setConnecting] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState<string>();
  const [problem, setProblem] = useState<{ copy: AccountCopy; environment: EnvironmentSummary }>();
  const attempt = useRef<AbortController>(undefined);
  useMountEffect(() => () => {
    attempt.current?.abort();
    attempt.current = undefined;
  });

  const currentId =
    current?.saved.kind === "managed" && current.saved.binding.ownerId === ownerId
      ? current.saved.binding.environmentId
      : undefined;

  async function connect(environment: EnvironmentSummary, repair: boolean) {
    if (attempt.current !== undefined) return;
    const controller = new AbortController();
    attempt.current = controller;
    setConnecting(environment.id);
    setProblem(undefined);
    const ending = await account.connect({
      ownerId,
      environment,
      repair,
      signal: controller.signal,
    });

    if (attempt.current !== controller) return;
    attempt.current = undefined;
    setConnecting(undefined);

    if (ending.kind === "connected" || ending.kind === "cancelled") return;
    setProblem({ copy: connectEndingCopy(ending), environment });

    if (
      ending.kind === "broker" &&
      ending.failure.kind === "refused" &&
      ["forbidden", "not_found", "revoked"].includes(ending.failure.code)
    )
      void environments.refetch();
  }

  async function remove(environment: EnvironmentSummary) {
    setRemoving(environment.id);

    try {
      await broker.removeEnvironment({ environmentId: environment.id });
      toast.show(`Removed ${environment.name}`);
    } catch (cause) {
      const copy =
        cause instanceof BrokerError
          ? brokerCopy(cause.failure)
          : { title: "Couldn't remove it", body: "Try again." };

      toast.error(`Couldn't remove ${environment.name}`, copy.body);
    }

    setRemoving(undefined);
    void environments.refetch();
  }

  function confirmRemove(environment: EnvironmentSummary) {
    Alert.alert(
      `Remove ${environment.name}?`,
      "It leaves your Nyte account, and every phone connected to it loses access. To add it back, link it again from that computer.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => void remove(environment) },
      ],
    );
  }

  function cancel() {
    attempt.current?.abort();
    attempt.current = undefined;
    setConnecting(undefined);
  }

  const listProblem: AccountCopy | undefined =
    environments.error === null
      ? undefined
      : environments.error instanceof BrokerError
        ? brokerCopy(environments.error.failure)
        : { title: "Couldn't load your computers", body: "Try again.", action: "retry" };
  const shown = problem?.copy ?? listProblem;
  const connectedId = current?.reconnect ? undefined : currentId;
  const macs = environments.data?.environments.filter(
    (environment) => environment.id !== connectedId,
  );
  const editable = macs !== undefined && macs.length > 0 && connecting === undefined;
  const inEdit = editing && editable;

  return (
    <>
      <html.div style={styles.headerRow}>
        <html.div style={styles.grow}>
          <SectionHeader label={connectedId === undefined ? "Your computers" : "Other computers"} />
        </html.div>
        {editable ? (
          <html.button onClick={() => setEditing(!inEdit)} style={styles.headerAction}>
            <html.span style={[textStyles.secondary, styles.accent, inEdit && styles.bold]}>
              {inEdit ? "Done" : "Edit"}
            </html.span>
          </html.button>
        ) : null}
      </html.div>
      <Group>
        {environments.isPending ? (
          <GroupRow>
            <ActivityIndicator color={theme.muted} />
            <html.span style={textStyles.caption}>Finding your computers…</html.span>
          </GroupRow>
        ) : null}
        {macs?.length === 0 ? (
          <GroupRow>
            <IconTile name="laptopcomputer" />
            <html.div style={styles.rowText}>
              <html.span style={textStyles.body}>
                {connectedId === undefined
                  ? "No computers on this account yet"
                  : "No other computers on this account"}
              </html.span>
              <html.span style={[textStyles.caption, styles.start]}>
                On a Mac, open {SHARE_LOCATION} and choose Link This Mac… On a server, run nyte
                account.
              </html.span>
            </html.div>
          </GroupRow>
        ) : null}
        {(macs ?? []).map((environment) => {
          const active = connecting === environment.id;
          const isCurrent = environment.id === currentId;
          const leaving = removing === environment.id;
          const locked =
            (connecting !== undefined && !active) || (removing !== undefined && !leaving);

          return (
            <GroupRow
              key={environment.id}
              busy={active || leaving}
              disabled={locked}
              onClick={
                locked
                  ? undefined
                  : inEdit
                    ? () => confirmRemove(environment)
                    : () => void connect(environment, false)
              }
            >
              <IconTile
                name="laptopcomputer"
                color={environment.online || isCurrent ? theme.foreground : undefined}
              />
              <html.div style={styles.rowText}>
                <html.span style={[textStyles.body, styles.clamp]}>{environment.name}</html.span>
                <html.span style={textStyles.caption}>
                  {active
                    ? "Connecting…"
                    : leaving
                      ? "Removing…"
                      : isCurrent
                        ? "Tap to reconnect"
                        : environment.online
                          ? "Online"
                          : "Offline"}
                </html.span>
              </html.div>
              {active || leaving ? (
                <ActivityIndicator color={theme.muted} />
              ) : inEdit ? (
                <SymbolView
                  name="minus.circle.fill"
                  size={controls.icon}
                  tintColor={theme.danger}
                />
              ) : (
                <SymbolView
                  name="chevron.right"
                  size={controls.iconXs}
                  weight="semibold"
                  tintColor={isCurrent ? theme.accent : theme.interactiveTertiary}
                />
              )}
            </GroupRow>
          );
        })}
      </Group>
      {shown === undefined ? null : (
        <Notice
          copy={shown}
          action={
            shown.action === "signIn"
              ? { label: "Sign In Again", onPress: onRenew }
              : problem !== undefined && shown.action === "repair"
                ? {
                    label: "Pair as New Host",
                    onPress: () => void connect(problem.environment, true),
                  }
                : problem === undefined && shown.action === "retry"
                  ? { label: "Try Again", onPress: () => void environments.refetch() }
                  : undefined
          }
        />
      )}
      {connecting === undefined ? (
        <html.div style={styles.footnote}>
          <html.span style={[textStyles.caption, styles.grow]}>
            The computer needs to be awake and running Nyte.
          </html.span>
          <html.button
            aria-label="Refresh your computers"
            disabled={environments.isFetching}
            onClick={() => void environments.refetch()}
            style={styles.textButton}
          >
            <html.span style={[textStyles.label, styles.accent]}>Refresh</html.span>
          </html.button>
        </html.div>
      ) : (
        <html.div style={styles.inset}>
          <GlassButton label="Cancel Connection" fill onPress={cancel} />
        </html.div>
      )}
    </>
  );
}

function Notice({
  copy,
  action,
}: {
  copy: AccountCopy;
  action?: { readonly label: string; readonly onPress: () => void };
}) {
  const theme = useTheme();

  return (
    <html.div role="alert" style={styles.notice}>
      <SymbolView
        name="exclamationmark.circle.fill"
        size={controls.icon}
        tintColor={theme.danger}
      />
      <html.div style={styles.noticeText}>
        <html.p style={[textStyles.error, styles.text]}>{copy.title}</html.p>
        <html.p style={[textStyles.caption, styles.text]}>{copy.body}</html.p>
        {action === undefined ? null : (
          <html.button onClick={action.onPress} style={styles.textButton}>
            <html.span style={[textStyles.label, styles.accent]}>{action.label}</html.span>
          </html.button>
        )}
      </html.div>
    </html.div>
  );
}

export type ConnectionSheetPage = "overview" | "manual";

export function ConnectSheet({
  page,
  onClose,
  account,
  current,
}: {
  page: ConnectionSheetPage | undefined;
  onClose: () => void;
  account: Account | undefined;
  current: Current;
}) {
  const [view, setView] = useState<ConnectionSheetPage>(page ?? "overview");
  const [seenPage, setSeenPage] = useState(page);

  if (seenPage !== page) {
    setSeenPage(page);
    if (page !== undefined) setView(page);
  }

  return (
    <Modal
      visible={page !== undefined}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      {page === undefined ? null : (
        <SafeAreaProvider>
          {view === "manual" ? (
            <ConnectionForm
              mode={
                current.saved.kind === "manual"
                  ? { kind: "edit", connection: current.saved.connection }
                  : { kind: "connect", method: "direct", initial: undefined }
              }
              onCancel={() => {
                if (page === "overview") setView("overview");
                else onClose();
              }}
              onSaved={onClose}
            />
          ) : (
            <SheetBody
              onClose={onClose}
              account={account}
              current={current}
              onManual={() => setView("manual")}
            />
          )}
        </SafeAreaProvider>
      )}
    </Modal>
  );
}

function SheetBody({
  onClose,
  account,
  current,
  onManual,
}: Omit<Parameters<typeof ConnectSheet>[0], "page"> & { onManual: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { connection } = current.saved;

  return (
    <html.div style={styles.sheet}>
      <html.div style={styles.header}>
        <IconTile name="laptopcomputer" color={theme.foreground} />
        <html.div style={styles.rowText}>
          <html.h1 style={[textStyles.headline, styles.heading]}>{connection.name}</html.h1>
          <html.span style={textStyles.caption}>
            {current.saved.kind === "managed"
              ? "Connected through your Nyte account"
              : `Connected · ${displayAddress(connection)}`}
          </html.span>
        </html.div>
        <GlassButton label="Close" systemImage="xmark" onPress={onClose} iconOnly />
      </html.div>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.lg }}>
        {account === undefined ? (
          <Group>
            <GroupRow onClick={onManual}>
              <IconTile name="pencil" />
              <html.span style={textStyles.body}>
                {current.saved.kind === "manual" ? "Edit connection" : "Connect directly"}
              </html.span>
            </GroupRow>
          </Group>
        ) : (
          <ConnectPanel
            account={account}
            current={current}
            manual={{
              onPress: onManual,
              label: current.saved.kind === "manual" ? "Edit connection" : "Connect directly",
            }}
          />
        )}
      </ScrollView>
    </html.div>
  );
}

const styles = css.create({
  sheet: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    backgroundColor: tokens.background,
  },
  panel: { display: "flex", flexDirection: "column" },
  profileGroup: { display: "flex", flexDirection: "column", gap: spacing.md },
  profileLabel: { flexShrink: 1, minWidth: 0, textAlign: "start" },
  avatar: (size: number) => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: size,
    height: size,
    borderRadius: size / 2,
    flexShrink: 0,
    overflow: "hidden",
  }),
  avatarImage: (size: number) => ({ width: size, height: size, objectFit: "cover" }),
  inset: { paddingInline: list.gutter },
  headerRow: { display: "flex", flexDirection: "row", alignItems: "flex-end" },
  headerAction: {
    display: "flex",
    alignItems: "flex-end",
    minHeight: controls.touchTarget,
    paddingInline: list.gutter,
    paddingBottom: list.headerGap,
    borderWidth: 0,
    backgroundColor: "transparent",
    opacity: { default: 1, ":active": controls.pressedOpacity },
  },
  bold: { fontWeight: 600 },
  header: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.gutter,
    gap: spacing.md,
  },
  heading: { margin: 0, lineClamp: 1, textAlign: "start" },
  text: { margin: 0 },
  grow: { flexGrow: 1, flexShrink: 1, textAlign: "start" },
  start: { textAlign: "start" },
  clamp: { lineClamp: 1, textAlign: "start" },
  danger: { color: tokens.danger },
  accent: { color: tokens.accent },
  rowText: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    gap: list.titleMetaGap,
  },
  footnote: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingInline: list.gutter,
    paddingTop: spacing.sm,
  },
  textButton: {
    display: "flex",
    alignItems: "center",
    alignSelf: "flex-start",
    flexShrink: 0,
    minHeight: controls.metaTarget,
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    opacity: {
      default: 1,
      ":active": controls.pressedOpacity,
      ":disabled": controls.disabledOpacity,
    },
  },
  notice: {
    display: "flex",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    paddingInline: list.gutter,
    paddingTop: spacing.md,
  },
  noticeText: { display: "flex", flexDirection: "column", gap: spacing.xs, flexShrink: 1 },
});
