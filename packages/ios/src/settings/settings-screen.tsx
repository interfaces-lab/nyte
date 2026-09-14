import Constants from "expo-constants";
import { useEffect, useState } from "react";
import { Alert, ScrollView } from "react-native";
import { css, html } from "react-strict-dom";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { WorkspaceInfo } from "@nyte-ai/protocol";
import { useHost } from "../connection/host-context.tsx";
import { displayAddress } from "../connection/connection.ts";
import { Group, GroupRow } from "../ui/group.tsx";
import { IconTile } from "../ui/icon-tile.tsx";
import { SectionHeader } from "../ui/section-header.tsx";
import { list, spacing, textStyles, tokens, useTheme } from "../theme.ts";

type HostStatus = "checking" | "connected" | "unreachable";

export function SettingsScreen() {
  const theme = useTheme();
  const { client, connection, disconnect } = useHost();
  const insets = useSafeAreaInsets();
  // Results are keyed by revision, so a stale reply never masks a newer check.
  const [result, setResult] = useState<{ revision: number; status: HostStatus }>();
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [workspaces, setWorkspaces] = useState<
    { kind: "loading" } | { kind: "failed" } | { kind: "ready"; list: readonly WorkspaceInfo[] }
  >({ kind: "loading" });
  const version = Constants.expoConfig?.version ?? "0.0.0";
  const status: HostStatus = result?.revision === revision ? result.status : "checking";

  useEffect(() => {
    let active = true;
    const attempt = revision;
    void client
      .info()
      .then(() => {
        if (active) setResult({ revision: attempt, status: "connected" });
      })
      .catch(() => {
        if (active) setResult({ revision: attempt, status: "unreachable" });
      });
    void client.workspace
      .list()
      .then((items) => {
        if (active) setWorkspaces({ kind: "ready", list: items });
      })
      .catch(() => {
        if (active) setWorkspaces({ kind: "failed" });
      });
    return () => {
      active = false;
    };
  }, [client, revision]);

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
  const workspaceList = workspaces.kind === "ready" ? workspaces.list : undefined;

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ flexGrow: 1 }}
      contentInsetAdjustmentBehavior="automatic"
    >
      <html.div style={[styles.page, styles.bottomInset(insets.bottom)]}>
        <Group>
          <GroupRow>
            <IconTile name="laptopcomputer" color={theme.foreground} />
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
            last
            disabled={status === "checking"}
            onClick={() => setRevision((value) => value + 1)}
          >
            <IconTile name="arrow.clockwise" />
            <html.span style={textStyles.body}>
              {status === "unreachable" ? "Try again" : "Check connection"}
            </html.span>
          </GroupRow>
        </Group>
        {error !== undefined && (
          <html.p role="alert" style={textStyles.error}>
            {error}
          </html.p>
        )}
        {workspaceList !== undefined && workspaceList.length > 0 ? (
          <>
            <SectionHeader label="Workspaces" />
            <Group>
              {workspaceList.map((workspace, index) => (
                <GroupRow key={workspace.path} last={index === workspaceList.length - 1}>
                  <IconTile name="folder" />
                  <html.div style={styles.rowText}>
                    <html.span style={textStyles.body}>{workspace.name}</html.span>
                    <html.span style={[textStyles.caption, styles.path]}>
                      {workspace.path}
                    </html.span>
                  </html.div>
                </GroupRow>
              ))}
            </Group>
          </>
        ) : null}
        <html.div style={styles.signOut}>
          <Group>
            <GroupRow last align="center" disabled={busy} onClick={confirmDisconnect}>
              <html.span style={[textStyles.body, styles.danger]}>
                {busy ? "Disconnecting…" : "Disconnect"}
              </html.span>
            </GroupRow>
          </Group>
        </html.div>
        <html.div style={styles.colophon}>
          <html.span style={styles.mark}>Nyte</html.span>
          <html.div style={styles.versionPill}>
            <html.span style={styles.version}>{version}</html.span>
          </html.div>
        </html.div>
      </html.div>
    </ScrollView>
  );
}

const styles = css.create({
  page: {
    flexGrow: 1,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  bottomInset: (bottom: number) => ({ paddingBottom: bottom + spacing.lg }),
  rowText: { flexGrow: 1, flexShrink: 1, minWidth: 0, alignItems: "flex-start", gap: 2 },
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
  signOut: { paddingTop: list.sectionGap - spacing.md },
  colophon: {
    flexGrow: 1,
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
