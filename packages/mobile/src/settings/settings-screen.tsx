import Constants from "expo-constants";
import { useState } from "react";
import { Alert, ScrollView } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { SymbolView } from "expo-symbols";
import { css, html } from "react-strict-dom";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NyteWireError } from "@nyte-ai/client";
import { useAccount } from "../account/account-provider.tsx";
import { ConnectSheet } from "../account/connect-panel.tsx";
import { useHost } from "../connection/host-context.tsx";
import { displayAddress } from "../connection/connection.ts";
import { usesWorkspaceCursor } from "../chat/workspace-menu.ts";
import { useRegistryFolders } from "../chat/workspace-start.tsx";
import { Group, GroupRow } from "../ui/group.tsx";
import { IconTile } from "../ui/icon-tile.tsx";
import { SectionHeader } from "../ui/section-header.tsx";
import { ChoiceRow, SwitchRow } from "./setting-rows.tsx";
import {
  useAppearance,
  useDateSections,
  useFilterCards,
  useTranscriptFont,
  useTwoLinePreview,
} from "./preferences.ts";
import { controls, list, spacing, textStyles, tokens, useTheme } from "../theme.ts";

type HostStatus = "checking" | "connected" | "unreachable" | "refused";

export function SettingsScreen() {
  const theme = useTheme();
  const { client, info, connection, saved, edit, disconnect } = useHost();
  const account = useAccount();
  const [connectOpen, setConnectOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const appearance = useAppearance();
  const transcriptFont = useTranscriptFont();
  const [filterCards, setFilterCards] = useFilterCards();
  const [dateSections, setDateSections] = useDateSections();
  const [twoLinePreview, setTwoLinePreview] = useTwoLinePreview();

  const check = useQuery({
    queryKey: ["host-check"],
    retry: false,
    queryFn: async () => {
      await client.info();

      return null;
    },
  });

  const workspacesQuery = useQuery({
    queryKey: ["workspace-list"],
    retry: false,
    enabled: usesWorkspaceCursor(info),
    queryFn: () => client.workspace.list(),
  });

  const registry = useRegistryFolders();

  const version = Constants.expoConfig?.version ?? "0.0.0";

  // An account host that refuses this iPhone is not retried or re-enrolled on
  // its own: a revocation must stay revoked until the user reconnects.
  const refused =
    saved.kind === "managed" &&
    check.error instanceof NyteWireError &&
    (check.error.code === "unauthorized" || check.error.code === "forbidden");

  const status: HostStatus = check.isFetching
    ? "checking"
    : refused
      ? "refused"
      : check.isError
        ? "unreachable"
        : "connected";

  // Disconnecting deletes the saved token, so reconnecting means copying it from the host again.
  function confirmDisconnect() {
    if (busy) return;
    Alert.alert(
      `Disconnect from ${connection.name}?`,
      saved.kind === "managed"
        ? "To connect again, pick it from your Nyte account."
        : "To connect again, you'll need its address and token.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: () => {
            setBusy(true);
            void disconnect().catch(() => {
              setBusy(false);
              setError("Couldn't remove the saved connection. Try again.");
            });
          },
        },
      ],
    );
  }

  const statusLabel =
    status === "checking"
      ? "Checking…"
      : status === "connected"
        ? "Connected"
        : status === "refused"
          ? "Not accepted"
          : "Unreachable";

  const statusColor =
    status === "checking" ? theme.muted : status === "connected" ? theme.success : theme.danger;

  // A registry host shares only the folders its owner made ready; a cursor host lists its recents.
  const workspaceList =
    registry === undefined
      ? workspacesQuery.data
      : registry.kind === "ready"
        ? registry.ready
        : undefined;

  return (
    <ScrollView
      style={{ flex: 1 }}
      // The page's box is the scroll view's own content: an inner styled box
      // would be a flex child of a native parent, which cannot grow it.
      contentContainerStyle={{
        flexGrow: 1,
        paddingTop: spacing.sm,
        paddingBottom: insets.bottom + spacing.lg,
      }}
      contentInsetAdjustmentBehavior="automatic"
    >
      {account === undefined ? null : (
        <ConnectSheet
          open={connectOpen}
          onClose={() => setConnectOpen(false)}
          account={account}
          current={{ saved, reconnect: refused }}
          onManual={() => {
            setConnectOpen(false);
            edit();
          }}
        />
      )}
      <SectionHeader label="Display" first />
      <Group>
        <ChoiceRow label="Appearance" icon="circle.lefthalf.filled" setting={appearance} />
        <ChoiceRow label="Message font" icon="textformat" setting={transcriptFont} />
      </Group>
      <SectionHeader label="Inbox" />
      <Group>
        <SwitchRow
          label="Show filters"
          icon="line.3.horizontal.decrease"
          value={filterCards}
          onChange={setFilterCards}
        />
        <SwitchRow
          label="Sections by date"
          icon="calendar"
          value={dateSections}
          onChange={setDateSections}
        />
        <SwitchRow
          label="Two-line preview"
          icon="text.alignleft"
          value={twoLinePreview}
          onChange={setTwoLinePreview}
        />
      </Group>
      <SectionHeader label="Connection" />
      <Group>
        <GroupRow onClick={account === undefined ? undefined : () => setConnectOpen(true)}>
          <IconTile name="laptopcomputer" color={theme.foreground} />
          <html.div style={styles.rowText}>
            <html.span style={textStyles.headline}>{connection.name}</html.span>
            <html.div style={styles.metadata}>
              <html.span style={textStyles.caption}>
                {saved.kind === "managed"
                  ? account?.status.kind === "signedIn" &&
                    account.status.ownerId === saved.binding.ownerId
                    ? account.status.label
                    : "Nyte account"
                  : displayAddress(connection)}
              </html.span>
              <html.div style={styles.status} aria-live="polite">
                <html.div style={styles.statusDot(statusColor)} />
                <html.span style={textStyles.caption}>{statusLabel}</html.span>
              </html.div>
            </html.div>
          </html.div>
          {account === undefined ? null : (
            <SymbolView
              name="chevron.right"
              size={controls.iconXs}
              weight="semibold"
              tintColor={theme.interactiveTertiary}
            />
          )}
        </GroupRow>
        {status === "refused" ? (
          <GroupRow onClick={account === undefined ? edit : () => setConnectOpen(true)}>
            <IconTile name="arrow.triangle.2.circlepath" />
            <html.span style={textStyles.body}>Reconnect</html.span>
          </GroupRow>
        ) : (
          <GroupRow
            busy={status === "checking"}
            onClick={() => {
              void check.refetch();

              if (registry === undefined) void workspacesQuery.refetch();
              else if (registry.kind !== "loading") registry.refresh();
            }}
          >
            <IconTile name="arrow.clockwise" />
            <html.span style={textStyles.body}>
              {status === "unreachable" ? "Retry connection" : "Check connection"}
            </html.span>
          </GroupRow>
        )}
        <GroupRow onClick={edit}>
          <IconTile name="pencil" />
          <html.span style={textStyles.body}>Edit connection</html.span>
        </GroupRow>
      </Group>
      {error !== undefined && (
        <html.p role="alert" style={[textStyles.error, styles.error]}>
          {error}
        </html.p>
      )}
      {workspaceList !== undefined && workspaceList.length > 0 ? (
        <>
          <SectionHeader label="Workspaces" />
          <Group>
            {workspaceList.map((workspace) => (
              <GroupRow key={workspace.path}>
                <IconTile name="folder" />
                <html.div style={styles.rowText}>
                  <html.span style={textStyles.body}>{workspace.name}</html.span>
                  <html.span style={[textStyles.caption, styles.path]}>{workspace.path}</html.span>
                </html.div>
              </GroupRow>
            ))}
          </Group>
        </>
      ) : null}
      <html.div style={styles.disconnect}>
        <Group>
          <GroupRow busy={busy} onClick={confirmDisconnect}>
            <IconTile name="rectangle.portrait.and.arrow.right" color={theme.danger} />
            <html.span style={[textStyles.body, styles.danger]}>
              {busy ? "Disconnecting…" : "Disconnect"}
            </html.span>
          </GroupRow>
        </Group>
      </html.div>
      <html.div style={styles.colophon}>
        <html.span style={textStyles.caption}>Nyte {version}</html.span>
      </html.div>
    </ScrollView>
  );
}

const styles = css.create({
  rowText: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    alignItems: "flex-start",
    gap: 2,
  },
  path: { textAlign: "start" },
  metadata: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.sm,
  },
  status: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    gap: spacing.xs,
  },
  statusDot: (color: string) => ({
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: color,
  }),
  danger: { color: tokens.danger },
  error: { paddingInline: list.gutter },
  disconnect: { marginBlockStart: list.sectionGap },
  colophon: {
    display: "flex",
    alignItems: "center",
    paddingBlock: spacing.xl,
  },
});
