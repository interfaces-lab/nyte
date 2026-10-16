import { useCallback, useMemo, useState, type ReactElement } from "react";
import type { RefreshControlProps } from "react-native";
import { ActivityIndicator, RefreshControl, SectionList } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { SymbolView } from "expo-symbols";
import { css, html } from "react-strict-dom";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Host, Picker, Text } from "@expo/ui/swift-ui";
import { pickerStyle, tag } from "@expo/ui/swift-ui/modifiers";
import { readHunks } from "@nyte-ai/schema";
import type { Hunk } from "@nyte-ai/schema";
import type { Connection, FileStatus, PatchEntry, PatchSet, SessionId } from "@nyte-ai/sdk";
import { EmptyState } from "../ui/empty-state.tsx";
import { GlassButton } from "../ui/glass-button.tsx";
import { describeHostError } from "../connection/connection.ts";
import { useRemoteChat } from "./remote-chat.ts";
import { changedFiles, fileStatus } from "./turn-changes.ts";
import { controls, useTheme, spacing, textStyles, tokens } from "../theme.ts";

type Source = "agent" | "mac" | "uncommitted";

type Line =
  | { kind: "hunk"; text: string }
  | { kind: "context" | "added" | "removed"; gutter: number | undefined; text: string };

type TextPatch = Extract<PatchEntry, { kind: "text" }>;

type FileSection = {
  key: string;
  path: string;
  status: "A" | "M" | "D" | "R";
  added: number;
  removed: number;
  subtitle: string | undefined;
  file: TextPatch;
  hunks: readonly Hunk[];
  lineCount: number;
};

/** Long patches render their head first; the rest waits for a tap. */
const LINE_LIMIT = 400;

/** How much of one file is on screen. The header toggles, the footer promotes. */
type FileView = "collapsed" | "head" | "whole";

/** A file's hunks → display lines with new-side (or old-side) line numbers. */
function displayLines(hunks: readonly Hunk[], limit: number): Line[] {
  const out: Line[] = [];

  for (const hunk of hunks) {
    if (out.length === limit) return out;

    out.push({
      kind: "hunk",
      text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
    });
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;

    for (const { kind, text } of hunk.lines) {
      if (out.length === limit) return out;

      if (kind === "add") {
        out.push({ kind: "added", gutter: newLine, text });
        newLine += 1;
      } else if (kind === "remove") {
        out.push({ kind: "removed", gutter: oldLine, text });
        oldLine += 1;
      } else {
        out.push({ kind: "context", gutter: newLine, text });
        oldLine += 1;
        newLine += 1;
      }
    }
  }

  return out;
}

function fileSection(file: TextPatch, subtitle: string | undefined): FileSection {
  const hunks = readHunks(file.patch);

  return {
    key: file.path + (subtitle ?? ""),
    path: file.path,
    status: fileStatus(file.status),
    added: file.added,
    removed: file.removed,
    subtitle,
    file,
    hunks,
    lineCount: hunks.reduce((count, hunk) => count + hunk.lines.length + 1, 0),
  };
}

async function textPatches(stream: AsyncIterable<PatchSet>): Promise<TextPatch[]> {
  let last: PatchSet | undefined;

  for await (const set of stream) last = set;

  return [...(last?.entries.values() ?? [])].flatMap((entry) =>
    entry.kind === "text" ? [entry] : [],
  );
}

/**
 * A session's changes, from the agent's record or the Mac's working tree. Past three files, only the
 * file the user arrived on starts open; a tap moves one file between collapsed, head, and full views.
 */
export function ChangesScreen({
  client,
  sessionId,
  initialPath,
  initialSource,
}: {
  client: Connection;
  sessionId: SessionId;
  initialPath: string | undefined;
  initialSource: Source | undefined;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [source, setSource] = useState<Source>(initialSource ?? "agent");
  const [views, setViews] = useState<ReadonlyMap<string, FileView>>(new Map());
  const [pulling, setPulling] = useState(false);
  const chat = useRemoteChat(client, sessionId);

  const workspaceId = chat.info?.workspace;

  const runs = useMemo(
    () =>
      (chat.state?.turns ?? []).flatMap((turn) =>
        turn.run !== null && changedFiles(turn) ? [turn.run] : [],
      ),
    [chat.state?.turns],
  );

  const conversationPaths = useMemo(
    () => (chat.state?.changes ?? []).map((change) => change.path),
    [chat.state?.changes],
  );

  const agentQuery = useQuery({
    queryKey: ["run-patches", sessionId, runs],
    enabled: source === "agent" && workspaceId !== undefined,
    queryFn: async () => {
      if (workspaceId === undefined) return [];
      const workspace = client.workspace(workspaceId);
      const perRun: TextPatch[][] = [];

      for (const run of runs) {
        const changed = await workspace.changes(run);
        const paths = changed.files.map((file) => file.path);
        perRun.push(await textPatches(workspace.patches(run, paths)));
      }

      return perRun;
    },
  });

  const git = async () => {
    if (workspaceId === undefined) throw new Error("This conversation's folder isn't known yet.");
    const capability = await client.workspace(workspaceId).git();

    if (capability.kind !== "available") throw new Error(capability.reason);

    return capability.api;
  };

  const macDiffsQuery = useQuery({
    queryKey: ["mac-diffs", sessionId, conversationPaths],
    enabled: source === "mac" && workspaceId !== undefined,
    queryFn: async () => {
      const api = await git();
      const scope = { kind: "worktree" } as const;

      const paths =
        conversationPaths.length > 0
          ? conversationPaths
          : (await api.changes(scope)).files.map((change) => change.path);

      return textPatches(api.patches(scope, paths));
    },
  });

  const snapshotQuery = useQuery({
    queryKey: ["vcs-snapshot", sessionId],
    enabled: source === "uncommitted" && workspaceId !== undefined,
    queryFn: async () => (await git()).status(),
  });

  const uncommitted: readonly { path: string; status: FileStatus; where: string }[] =
    snapshotQuery.data?.kind === "repository"
      ? [
          ...snapshotQuery.data.staged.map((file) => ({ ...file, where: "Staged" })),
          ...snapshotQuery.data.unstaged.map((file) => ({ ...file, where: "Unstaged" })),
          ...snapshotQuery.data.untracked.map((path) => ({
            path,
            status: "untracked" as const,
            where: "Untracked",
          })),
        ]
      : [];

  const macDiffs:
    | { kind: "loading" }
    | { kind: "failed"; message: string }
    | { kind: "ready"; diffs: readonly TextPatch[] } =
    macDiffsQuery.status === "pending"
      ? { kind: "loading" }
      : macDiffsQuery.status === "error"
        ? { kind: "failed", message: describeHostError(macDiffsQuery.error) }
        : { kind: "ready", diffs: macDiffsQuery.data };

  const sections = useMemo<FileSection[]>(() => {
    if (source === "agent") {
      const edits = new Map<string, TextPatch[]>();

      for (const file of (agentQuery.data ?? []).flat())
        edits.set(file.path, [...(edits.get(file.path) ?? []), file]);

      return [...edits.values()].flatMap((group) =>
        group.map((file, index) =>
          fileSection(
            file,
            group.length > 1 ? `Edit ${String(index + 1)} of ${String(group.length)}` : undefined,
          ),
        ),
      );
    }

    return (macDiffsQuery.data ?? []).map((file) => fileSection(file, undefined));
  }, [source, agentQuery.data, macDiffsQuery.data]);

  const readView = useCallback(
    (section: FileSection): FileView =>
      views.get(section.key) ??
      (sections.length > 3 && section.path !== initialPath ? "collapsed" : "head"),
    [views, sections.length, initialPath],
  );

  const setView = (key: string, view: FileView) =>
    setViews((current) => new Map(current).set(key, view));

  const agentEmpty = chat.state !== undefined && runs.length === 0;

  return (
    <html.div style={styles.screen}>
      <Host
        matchContents={{ vertical: true }}
        style={{ marginHorizontal: spacing.gutter, marginTop: spacing.sm }}
      >
        <Picker
          selection={source === "agent" ? 0 : source === "mac" ? 1 : 2}
          onSelectionChange={(selection) =>
            setSource(selection === 1 ? "mac" : selection === 2 ? "uncommitted" : "agent")
          }
          modifiers={[pickerStyle("segmented")]}
        >
          <Text modifiers={[tag(0)]}>Agent edits</Text>
          <Text modifiers={[tag(1)]}>On Mac</Text>
          <Text modifiers={[tag(2)]}>Uncommitted</Text>
        </Picker>
      </Host>
      <html.p style={[textStyles.caption, styles.caption]}>
        {source === "agent"
          ? "Files each agent run changed, by edit tools and commands alike."
          : source === "mac"
            ? "Current uncommitted changes on your Mac for these files. Can include edits made outside this conversation."
            : "Every file changed on your Mac since the last commit."}
      </html.p>
      {source === "uncommitted" ? (
        snapshotQuery.status === "pending" ? (
          <html.div style={styles.state}>
            <ActivityIndicator color={theme.muted} />
          </html.div>
        ) : uncommitted.length === 0 ? (
          <EmptyState title="Nothing to commit" description="The working tree is clean." />
        ) : (
          uncommitted.map((file) => (
            <html.div key={`${file.where}:${file.path}`} style={styles.fileHeader}>
              <html.div style={styles.badge}>
                <html.span style={styles.badgeText}>{fileStatus(file.status)}</html.span>
              </html.div>
              <html.div style={styles.fileHeaderText}>
                <html.span style={[textStyles.secondary, styles.fileName]}>{file.path}</html.span>
                <html.span style={textStyles.caption}>{file.where}</html.span>
              </html.div>
            </html.div>
          ))
        )
      ) : source === "agent" ? (
        chat.state === undefined || (!agentEmpty && agentQuery.status === "pending") ? (
          <html.div style={styles.state}>
            <ActivityIndicator color={theme.muted} />
          </html.div>
        ) : agentEmpty ? (
          <EmptyState
            title="No recorded edits"
            description="The agent didn't report file edits in this conversation. Try On Mac to see what's changed there."
          />
        ) : (
          <DiffSections sections={sections} readView={readView} onSetView={setView} />
        )
      ) : macDiffs.kind === "loading" ? (
        <html.div style={styles.state}>
          <ActivityIndicator color={theme.muted} />
        </html.div>
      ) : macDiffs.kind === "failed" ? (
        <html.div style={styles.state}>
          <html.p role="alert" style={textStyles.error}>
            {macDiffs.message}
          </html.p>
          <GlassButton label="Try again" fill onPress={() => void macDiffsQuery.refetch()} />
        </html.div>
      ) : sections.length === 0 ? (
        <EmptyState
          title="Nothing changed on your Mac"
          description="Not changed on your Mac now. It may have been committed or undone."
        />
      ) : (
        <DiffSections
          sections={sections}
          readView={readView}
          onSetView={setView}
          refreshControl={
            <RefreshControl
              tintColor={theme.muted}
              refreshing={pulling}
              onRefresh={() => {
                setPulling(true);
                void macDiffsQuery.refetch().finally(() => setPulling(false));
              }}
            />
          }
        />
      )}
      <html.div style={styles.bottom(insets.bottom)} />
    </html.div>
  );
}

function DiffSections({
  sections,
  readView,
  onSetView,
  refreshControl,
}: {
  sections: FileSection[];
  readView: (section: FileSection) => FileView;
  onSetView: (key: string, view: FileView) => void;
  refreshControl?: ReactElement<RefreshControlProps>;
}) {
  const theme = useTheme();

  const visibleSections = useMemo(
    () =>
      sections.map((section) => {
        const view = readView(section);

        return {
          ...section,
          data:
            view === "collapsed"
              ? []
              : displayLines(
                  section.hunks,
                  view === "head" ? LINE_LIMIT : Number.POSITIVE_INFINITY,
                ),
        };
      }),
    [sections, readView],
  );

  return (
    <SectionList<Line, FileSection>
      sections={visibleSections}
      keyExtractor={(item: Line, index: number) =>
        item.kind === "hunk"
          ? `hunk-${String(index)}-${item.text}`
          : `${String(index)}-${item.kind}`
      }
      stickySectionHeadersEnabled
      refreshControl={refreshControl}
      contentContainerStyle={{ paddingBottom: spacing.xl }}
      renderSectionHeader={({ section }) => {
        const collapsed = readView(section) === "collapsed";

        return (
          <html.button
            aria-expanded={!collapsed}
            onClick={() => onSetView(section.key, collapsed ? "head" : "collapsed")}
            style={styles.fileHeader}
          >
            <html.div style={styles.badge}>
              <html.span style={styles.badgeText}>{section.status}</html.span>
            </html.div>
            <html.div style={styles.fileHeaderText}>
              <html.span style={[textStyles.secondary, styles.fileName]}>
                {section.path.split("/").pop()}
              </html.span>
              <html.span style={textStyles.caption}>
                {section.subtitle ?? section.path.split("/").slice(0, -1).join("/")}
              </html.span>
            </html.div>
            <html.span style={[textStyles.caption, styles.totals]}>
              {`+${String(section.added)} \u2212${String(section.removed)}`}
            </html.span>
            <SymbolView
              name={collapsed ? "chevron.down" : "chevron.up"}
              size={13}
              weight="semibold"
              tintColor={theme.interactiveTertiary}
            />
          </html.button>
        );
      }}
      renderSectionFooter={({ section }) => {
        const hidden = section.lineCount - LINE_LIMIT;

        if (readView(section) !== "head" || hidden <= 0) return null;

        return (
          <html.button onClick={() => onSetView(section.key, "whole")} style={styles.showRest}>
            <html.span style={textStyles.secondary}>
              {`Show ${String(hidden)} more ${hidden === 1 ? "line" : "lines"}`}
            </html.span>
          </html.button>
        );
      }}
      renderItem={({ item }) => {
        if (item.kind === "hunk")
          return <html.p style={[textStyles.caption, styles.hunk]}>{item.text}</html.p>;

        return (
          <html.div
            style={[
              styles.line,
              item.kind === "added" && styles.lineAdded,
              item.kind === "removed" && styles.lineRemoved,
            ]}
          >
            <html.span style={[textStyles.diff, styles.gutter]}>
              {item.gutter === undefined ? "" : String(item.gutter)}
            </html.span>
            <html.span
              style={[
                textStyles.diff,
                item.kind === "added" && styles.markAdded,
                item.kind === "removed" && styles.markRemoved,
              ]}
            >
              {item.kind === "added" ? "+" : item.kind === "removed" ? "\u2212" : " "}
            </html.span>
            <html.span style={[textStyles.diff, styles.lineText]}>{item.text}</html.span>
          </html.div>
        );
      }}
    />
  );
}

const styles = css.create({
  showRest: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: controls.touchTarget,
    borderWidth: 0,
    backgroundColor: { default: "transparent", ":active": tokens.fill },
  },
  screen: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    backgroundColor: tokens.background,
  },
  caption: { paddingInline: spacing.gutter, paddingBlock: spacing.sm },
  state: {
    display: "flex",
    flexDirection: "column",
    paddingBlock: spacing.xxl,
    alignItems: "center",
    gap: spacing.md,
  },
  bottom: (inset: number) => ({ paddingBottom: inset }),
  fileHeader: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: controls.composerHeight,
    paddingInline: spacing.gutter,
    borderWidth: 0,
    borderBottomWidth: controls.hairline,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.separator,
    backgroundColor: { default: tokens.background, ":active": tokens.fill },
  },
  fileHeaderText: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    alignItems: "flex-start",
    gap: 1,
  },
  fileName: { color: tokens.foreground, fontWeight: 600, lineClamp: 1 },
  totals: { fontVariant: "tabular-nums", flexShrink: 0 },
  badge: {
    display: "flex",
    flexDirection: "column",
    width: controls.badge,
    height: controls.badge,
    borderRadius: 6,
    backgroundColor: tokens.fill,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  badgeText: { color: tokens.muted, fontSize: 11, lineHeight: "14px", fontWeight: 600 },
  hunk: {
    paddingInline: spacing.md,
    paddingBlock: spacing.xs,
    marginTop: spacing.sm,
    backgroundColor: tokens.fill,
  },
  line: {
    display: "flex",
    flexDirection: "row",
    paddingInline: spacing.md,
    gap: spacing.md,
  },
  lineAdded: { backgroundColor: tokens.successFill },
  lineRemoved: { backgroundColor: tokens.dangerFill },
  gutter: {
    width: controls.diffGutter,
    textAlign: "right",
    color: tokens.muted,
    fontVariant: "tabular-nums",
  },
  markAdded: { color: tokens.success },
  markRemoved: { color: tokens.danger },
  lineText: { flexGrow: 1, flexShrink: 1, whiteSpace: "pre-wrap" },
});
