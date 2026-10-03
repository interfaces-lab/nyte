import { useRef, useState } from "react";
import { ActivityIndicator, Alert, Modal, ScrollView, View } from "react-native";
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
import { controls, list, spacing, textStyles, tokens, useTheme } from "../theme.ts";
import { brokerCopy, connectEndingCopy, releaseCopy, type AccountCopy } from "./account-copy.ts";
import type { Account, SignInEnding, SignOutEnding } from "./account-provider.tsx";

/** The saved connection a panel sits over. `reconnect` lets its own Mac be picked again. */
type Current = { readonly saved: SavedConnection; readonly reconnect: boolean };

/**
 * Nyte Connect: the account, its Macs, and the address-and-token way in, as
 * one panel. The connect screen shows it inline; Settings opens it in a sheet
 * from the connection row. Clerk's hosted page is only the sign-in step.
 */
export function ConnectPanel({
  account,
  current,
  manual,
}: {
  account: Account;
  current: Current | undefined;
  /** Opens the address-and-token form. `expanded` is set where the form unfolds in place. */
  manual: { readonly onPress: () => void; readonly expanded: boolean | undefined };
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
      <SectionHeader label="Nyte account" first />
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
            label="Sign In to Nyte"
            systemImage="person.crop.circle"
            busy={busy}
            prominent
            fill
            onPress={() => void signIn(false)}
          />
        </html.div>
      ) : (
        <Group>
          <GroupRow>
            <IconTile name="person.crop.circle.fill" color={theme.foreground} />
            <html.div style={styles.rowText}>
              <html.span style={[textStyles.body, styles.clamp]}>{status.label}</html.span>
              <html.span style={textStyles.caption}>Signed in</html.span>
            </html.div>
          </GroupRow>
          <GroupRow busy={busy} onClick={() => void signIn(true)}>
            <IconTile name="arrow.left.arrow.right" />
            <html.span style={textStyles.body}>Switch Account</html.span>
          </GroupRow>
          <GroupRow busy={busy} onClick={confirmSignOut}>
            <IconTile name="rectangle.portrait.and.arrow.right" color={theme.danger} />
            <html.span style={[textStyles.body, styles.danger]}>Sign Out</html.span>
          </GroupRow>
        </Group>
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
      <SectionHeader label="Advanced" />
      <Group>
        <GroupRow onClick={manual.onPress}>
          <IconTile name="qrcode" />
          <html.span style={[textStyles.body, styles.grow]}>
            Connect with Address and Token
          </html.span>
          <SymbolView
            name={
              manual.expanded === undefined
                ? "chevron.right"
                : manual.expanded
                  ? "chevron.up"
                  : "chevron.down"
            }
            size={controls.iconXs}
            weight="semibold"
            tintColor={theme.interactiveTertiary}
          />
        </GroupRow>
      </Group>
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
    case "failed":
      return { title: "Couldn't sign in", body: "Try signing in again.", action: "retry" };
    default: {
      const exhaustive: never = ending;

      return exhaustive;
    }
  }
}

function signOutNotice(ending: SignOutEnding): AccountCopy | undefined {
  if (ending.kind === "notRemoved")
    return {
      title: "Still signed in",
      body: "The Keychain kept this Mac's connection. Unlock your phone and try again.",
      action: "retry",
    };

  // Letting go of the Mac usually closes this panel, so its outcome is a toast.
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
  // Keyed by owner and dropped on any account change. Ids and names only, never a credential.
  const environments = useQuery(
    {
      queryKey: ["account", ownerId, "environments"],
      queryFn: ({ signal }) => broker.listEnvironments({ signal }),
      retry: false,
    },
    account.queryClient,
  );
  const [connecting, setConnecting] = useState<string>();
  const [problem, setProblem] = useState<AccountCopy>();
  const attempt = useRef<AbortController>(undefined);
  useMountEffect(() => () => {
    attempt.current?.abort();
    attempt.current = undefined;
  });

  const currentId =
    current?.saved.kind === "managed" && current.saved.binding.ownerId === ownerId
      ? current.saved.binding.environmentId
      : undefined;

  async function connect(environment: EnvironmentSummary) {
    if (attempt.current !== undefined) return;
    const controller = new AbortController();
    attempt.current = controller;
    setConnecting(environment.id);
    setProblem(undefined);
    const ending = await account.connect({ ownerId, environment, signal: controller.signal });

    if (attempt.current !== controller) return;
    attempt.current = undefined;
    setConnecting(undefined);

    if (ending.kind === "connected" || ending.kind === "cancelled") return;
    setProblem(connectEndingCopy(ending));

    // The list was out of date: show the one the broker has now.
    if (
      ending.kind === "broker" &&
      ending.failure.kind === "refused" &&
      ["forbidden", "not_found", "revoked"].includes(ending.failure.code)
    )
      void environments.refetch();
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
        : { title: "Couldn't load your Macs", body: "Try again.", action: "retry" };
  const shown = problem ?? listProblem;
  const macs = environments.data?.environments;

  return (
    <>
      <SectionHeader label="Your Macs" />
      <Group>
        {environments.isPending ? (
          <GroupRow>
            <ActivityIndicator color={theme.muted} />
            <html.span style={textStyles.caption}>Finding your Macs…</html.span>
          </GroupRow>
        ) : null}
        {macs?.length === 0 ? (
          <GroupRow>
            <IconTile name="laptopcomputer" />
            <html.div style={styles.rowText}>
              <html.span style={textStyles.body}>No Macs on this account yet</html.span>
              <html.span style={[textStyles.caption, styles.start]}>
                On your Mac, open {SHARE_LOCATION} and choose Link This Mac…
              </html.span>
            </html.div>
          </GroupRow>
        ) : null}
        {(macs ?? []).map((environment) => {
          const active = connecting === environment.id;
          const isCurrent = environment.id === currentId;
          const locked =
            (connecting !== undefined && !active) || (isCurrent && !current?.reconnect);

          return (
            <GroupRow
              key={environment.id}
              busy={active}
              disabled={connecting !== undefined && !active}
              onClick={locked ? undefined : () => void connect(environment)}
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
                    : isCurrent
                      ? current?.reconnect
                        ? "Tap to reconnect"
                        : "Connected"
                      : environment.online
                        ? "Online"
                        : "Offline"}
                </html.span>
              </html.div>
              {active ? (
                <ActivityIndicator color={theme.muted} />
              ) : (
                <SymbolView
                  name={isCurrent && !current?.reconnect ? "checkmark" : "chevron.right"}
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
              : problem === undefined && shown.action === "retry"
                ? { label: "Try Again", onPress: () => void environments.refetch() }
                : undefined
          }
        />
      )}
      {connecting === undefined ? (
        <html.div style={styles.footnote}>
          <html.span style={[textStyles.caption, styles.grow]}>
            Your Mac needs to be awake with Nyte open.
          </html.span>
          <html.button
            aria-label="Refresh your Macs"
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

/**
 * The panel over a live connection, opened from Settings. A native page
 * sheet, not a route: the stack stays where it was.
 */
export function ConnectSheet({
  open,
  onClose,
  account,
  current,
  onManual,
}: {
  open: boolean;
  onClose: () => void;
  account: Account;
  current: Current;
  onManual: () => void;
}) {
  return (
    <Modal
      visible={open}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaProvider>
        <SheetBody onClose={onClose} account={account} current={current} onManual={onManual} />
      </SafeAreaProvider>
    </Modal>
  );
}

function SheetBody({
  onClose,
  account,
  current,
  onManual,
}: Omit<Parameters<typeof ConnectSheet>[0], "open">) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { connection } = current.saved;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <html.div style={styles.header}>
        <html.h1 style={[textStyles.title, styles.heading]}>Nyte Connect</html.h1>
        <GlassButton label="Close Nyte Connect" systemImage="xmark" onPress={onClose} iconOnly />
      </html.div>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.lg }}>
        <SectionHeader label="Connected" first />
        <Group>
          <GroupRow>
            <IconTile name="laptopcomputer" color={theme.foreground} />
            <html.div style={styles.rowText}>
              <html.span style={[textStyles.body, styles.clamp]}>{connection.name}</html.span>
              <html.span style={textStyles.caption}>
                {current.saved.kind === "managed"
                  ? "Through your Nyte account"
                  : displayAddress(connection)}
              </html.span>
            </html.div>
          </GroupRow>
        </Group>
        <html.div style={styles.gap} />
        <ConnectPanel
          account={account}
          current={current}
          manual={{ onPress: onManual, expanded: undefined }}
        />
      </ScrollView>
    </View>
  );
}

const styles = css.create({
  panel: { display: "flex", flexDirection: "column" },
  inset: { paddingInline: list.gutter },
  gap: { height: list.sectionGap },
  header: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.gutter,
    gap: spacing.md,
  },
  heading: { flexGrow: 1, margin: 0 },
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
