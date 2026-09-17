import Constants from "expo-constants";
import { useState } from "react";
import { Alert, ScrollView } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { css, html } from "react-strict-dom";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHost } from "../connection/host-context.tsx";
import { displayAddress } from "../connection/connection.ts";
import { Group, GroupRow } from "../ui/group.tsx";
import { IconRing } from "../ui/icon-tile.tsx";
import { SectionHeader } from "../ui/section-header.tsx";
import { ChoiceRow, SwitchRow } from "./setting-rows.tsx";
import {
  useAppearance,
  useDateSections,
  useFilterCards,
  useTranscriptFont,
  useTwoLinePreview,
} from "./preferences.ts";
import { list, spacing, textStyles, tokens, useTheme } from "../theme.ts";

type HostStatus = "checking" | "connected" | "unreachable";

export function SettingsScreen() {
  const theme = useTheme();
  const { client, connection, edit, disconnect } = useHost();
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
    queryFn: () => client.workspace.list(),
  });
  const version = Constants.expoConfig?.version ?? "0.0.0";
  const status: HostStatus = check.isFetching
    ? "checking"
    : check.isError
      ? "unreachable"
      : "connected";

  // Disconnecting deletes the saved token, so reconnecting means copying it from the Mac again.
  function confirmDisconnect() {
    Alert.alert(
      `Disconnect from ${connection.name}?`,
      "To connect again, you'll need the address and token from your Mac.",
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
    status === "checking" ? "Checking…" : status === "connected" ? "Connected" : "Unreachable";
  const statusColor =
    status === "checking" ? theme.muted : status === "connected" ? theme.success : theme.danger;
  const workspaceList = workspacesQuery.data;

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
      <SectionHeader label="Connection" first />
      <Group variant="flat">
        <GroupRow>
          <IconRing name="laptopcomputer" color={theme.foreground} />
          <html.div style={styles.rowText}>
            <html.span style={textStyles.body}>{connection.name}</html.span>
            <html.span style={textStyles.caption}>{displayAddress(connection)}</html.span>
          </html.div>
          <html.div style={styles.status} aria-live="polite">
            <html.div style={styles.statusDot(statusColor)} />
            <html.span style={textStyles.caption}>{statusLabel}</html.span>
          </html.div>
        </GroupRow>
        <GroupRow
          disabled={status === "checking"}
          onClick={() => {
            void check.refetch();
            void workspacesQuery.refetch();
          }}
        >
          <IconRing name="arrow.clockwise" />
          <html.span style={textStyles.body}>
            {status === "unreachable" ? "Try again" : "Check connection"}
          </html.span>
        </GroupRow>
        <GroupRow onClick={edit} trail="push">
          <IconRing name="pencil" />
          <html.div style={styles.rowText}>
            <html.span style={textStyles.body}>Edit address and token</html.span>
            <html.span style={textStyles.caption}>
              Your Mac issues a new pair each time sharing starts.
            </html.span>
          </html.div>
        </GroupRow>
      </Group>
      {error !== undefined && (
        <html.p role="alert" style={[textStyles.error, styles.error]}>
          {error}
        </html.p>
      )}
      <SectionHeader label="Style" />
      <Group variant="flat">
        <ChoiceRow label="Appearance" icon="circle.lefthalf.filled" setting={appearance} />
        <ChoiceRow label="Transcript font" icon="textformat" setting={transcriptFont} />
      </Group>
      <SectionHeader label="List" />
      <Group variant="flat">
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
      {workspaceList !== undefined && workspaceList.length > 0 ? (
        <>
          <SectionHeader label="Workspaces" />
          <Group variant="flat">
            {workspaceList.map((workspace) => (
              <GroupRow key={workspace.path}>
                <IconRing name="folder" />
                <html.div style={styles.rowText}>
                  <html.span style={textStyles.body}>{workspace.name}</html.span>
                  <html.span style={[textStyles.caption, styles.path]}>{workspace.path}</html.span>
                </html.div>
              </GroupRow>
            ))}
          </Group>
        </>
      ) : null}
      <SectionHeader label="Danger Zone" tone="danger" />
      <Group variant="flat">
        <GroupRow disabled={busy} onClick={confirmDisconnect}>
          <IconRing name="rectangle.portrait.and.arrow.right" color={theme.danger} />
          <html.span style={[textStyles.body, styles.danger]}>
            {busy ? "Disconnecting…" : "Disconnect"}
          </html.span>
        </GroupRow>
      </Group>
      <html.div style={styles.colophon}>
        <html.span style={styles.mark}>Nyte</html.span>
        <html.div style={styles.versionPill}>
          <html.span style={styles.version}>{version}</html.span>
        </html.div>
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
  path: { lineClamp: 1, textAlign: "start" },
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
  colophon: {
    display: "flex",
    flexDirection: "column",
    // The scroll view's content is the flex parent here, so the footer is
    // pushed down by its own margin rather than by growing inside it.
    marginBlockStart: "auto",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.sm,
    paddingBlock: spacing.xxl,
    minHeight: 160,
  },
  mark: {
    color: tokens.muted,
    fontSize: 11,
    lineHeight: "14px",
    fontWeight: 500,
    letterSpacing: 3,
    textTransform: "uppercase",
  },
  versionPill: {
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    borderRadius: 999,
    paddingInline: 8,
    paddingBlock: 2,
  },
  version: {
    color: tokens.muted,
    fontSize: 11,
    lineHeight: "14px",
    fontWeight: 500,
    letterSpacing: 0.6,
    fontVariant: "tabular-nums",
  },
});
