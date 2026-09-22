import { useCallback, useMemo, useState, type ReactElement } from "react";
import type { RefreshControlProps } from "react-native";
import { ActivityIndicator, RefreshControl, SectionList } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { SymbolView } from "expo-symbols";
import { css, html } from "react-strict-dom";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Host, Picker, Text } from "@expo/ui/swift-ui";
import { pickerStyle, tag } from "@expo/ui/swift-ui/modifiers";
import type { NyteClient } from "@nyte-ai/client";
import type { SessionId, VcsDiff, VcsFileKind } from "@nyte-ai/protocol";
import { parsePatchFacts, type PatchFile } from "@nyte-ai/client";
import { EmptyState } from "../ui/empty-state.tsx";
import { GlassButton } from "../ui/glass-button.tsx";
import { describeHostError } from "../connection/connection.ts";
import { useRemoteChat } from "./remote-chat.ts";
import { fileStatus, recordedEdits, type RecordedEdit } from "./turn-changes.ts";
import { controls, useTheme, spacing, textStyles, tokens } from "../theme.ts";

type Source = "agent" | "mac" | "uncommitted";

type Line =
  | { kind: "hunk"; text: string }
  | { kind: "context" | "added" | "removed"; gutter: number | undefined; text: string };

type FileSection = {
  key: string;
  path: string;
  status: "A" | "M" | "D" | "R";
  added: number;
  removed: number;
  subtitle: string | undefined;
  file: PatchFile;
  lineCount: number;
};

/** Long patches render their head first; the rest waits for a tap. */
const LINE_LIMIT = 400;

/** How much of one file is on screen. The header toggles, the footer promotes. */
type FileView = "collapsed" | "head" | "whole";

/** Parsed patch → display lines with new-side (or old-side) line numbers. */
function linesOf(file: PatchFile, limit: number): Line[] {
  const out: Line[] = [];

  for (const hunk of file.hunks) {
    if (out.length === limit) return out;

    out.push({
      kind: "hunk",
      text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
    });
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;

    for (const raw of hunk.lines) {
      if (out.length === limit) return out;

      const marker = raw[0];
      const text = raw.slice(1);

      if (marker === "+") {
        out.push({ kind: "added", gutter: newLine, text });
        newLine += 1;
      } else if (marker === "-") {
        out.push({ kind: "removed", gutter: oldLine, text });
        oldLine += 1;
      } else if (marker === "\\") {
        continue;
      } else {
        out.push({ kind: "context", gutter: newLine, text });
        oldLine += 1;
        newLine += 1;
      }
    }
  }

  return out;
}

function fileSection(file: PatchFile, path: string, subtitle: string | undefined): FileSection {
  return {
    key: path + (subtitle ?? ""),
    path,
    status: fileStatus(file),
    added: file.added,
    removed: file.removed,
    subtitle,
    file,
    lineCount: file.hunks.reduce((count, hunk) => count + hunk.oldLines + 1, file.added),
  };
}

function vcsStatus(kind: VcsFileKind): FileSection["status"] {
  switch (kind) {
    case "added":
    case "untracked":
      return "A";
    case "modified":
    case "conflicted":
      return "M";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    default: {
      const _exhaustive: never = kind;

      return _exhaustive;
    }
  }
}

export function ChangesScreen({
  client,
  sessionId,
  initialPath,
  initialSource,
}: {
  client: NyteClient;
  sessionId: SessionId;
  initialPath: string | undefined;
  initialSource: Source | undefined;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [source, setSource] = useState<Source>(initialSource ?? "agent");
  // Sections past three start collapsed; taps move one file between views.
  const [views, setViews] = useState<ReadonlyMap<string, FileView>>(new Map());
  const [pulling, setPulling] = useState(false);
  const chat = useRemoteChat(client, sessionId);

  const edits = useMemo(
    () => recordedEdits(chat.state?.transcript.items ?? []),
    [chat.state?.transcript.items],
  );

  const conversationPaths = useMemo(() => [...edits.keys()], [edits]);

  const macDiffsQuery = useQuery({
    queryKey: ["mac-diffs", sessionId, conversationPaths],
    enabled: source === "mac",
    queryFn: () =>
      client.workspace.vcs.diff({
        target: { kind: "session", sessionId },
        scope: { kind: "worktree" },
        paths: conversationPaths.length === 0 ? undefined : conversationPaths,
        ignoreWhitespace: false,
      }),
  });

  const snapshotQuery = useQuery({
    queryKey: ["vcs-snapshot", sessionId],
    enabled: source === "uncommitted",
    queryFn: () => client.workspace.vcs.snapshot({ target: { kind: "session", sessionId } }),
  });

  const uncommitted =
    snapshotQuery.data?.kind === "repository"
      ? [
          ...snapshotQuery.data.staged.map((file) => ({ ...file, where: "Staged" })),
          ...snapshotQuery.data.unstaged.map((file) => ({ ...file, where: "Unstaged" })),
        ]
      : [];

  const macDiffs:
    | { kind: "loading" }
    | { kind: "failed"; message: string }
    | { kind: "ready"; diffs: readonly VcsDiff[] } =
    macDiffsQuery.status === "pending"
      ? { kind: "loading" }
      : macDiffsQuery.status === "error"
        ? { kind: "failed", message: describeHostError(macDiffsQuery.error) }
        : { kind: "ready", diffs: macDiffsQuery.data };

  const sections = useMemo<FileSection[]>(() => {
    if (source === "agent") {
      const out: FileSection[] = [];

      for (const [path, group] of edits) {
        group.forEach((edit: RecordedEdit, index: number) => {
          out.push(
            fileSection(
              edit.file,
              path,
              group.length > 1 ? `Edit ${String(index + 1)} of ${String(group.length)}` : undefined,
            ),
          );
        });
      }

      return out;
    }

    if (macDiffsQuery.data === undefined) return [];
    const out: FileSection[] = [];

    for (const diff of macDiffsQuery.data) {
      if (diff.kind === "binary") continue;
      const facts = parsePatchFacts(diff.patch);

      if (facts === undefined) continue;

      for (const file of facts.files) {
        const path = file.path ?? diff.path;
        out.push({ ...fileSection(file, path, undefined), status: vcsStatus(diff.status) });
      }
    }

    return out;
  }, [source, edits, macDiffsQuery.data]);

  // Past three files, only the one the user arrived on starts open.
  const viewOf = useCallback(
    (section: FileSection): FileView =>
      views.get(section.key) ??
      (sections.length > 3 && section.path !== initialPath ? "collapsed" : "head"),
    [views, sections.length, initialPath],
  );

  const setView = (key: string, view: FileView) =>
    setViews((current) => new Map(current).set(key, view));

  const agentEmpty = chat.state !== undefined && edits.size === 0;

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
          ? "Edits the agent reported. Commands that changed files outside edit tools aren't included."
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
                <html.span style={styles.badgeText}>{vcsStatus(file.kind)}</html.span>
              </html.div>
              <html.div style={styles.fileHeaderText}>
                <html.span style={[textStyles.secondary, styles.fileName]}>{file.path}</html.span>
                <html.span style={textStyles.caption}>{file.where}</html.span>
              </html.div>
            </html.div>
          ))
        )
      ) : source === "agent" ? (
        chat.state === undefined ? (
          <html.div style={styles.state}>
            <ActivityIndicator color={theme.muted} />
          </html.div>
        ) : agentEmpty ? (
          <EmptyState
            title="No recorded edits"
            description="The agent didn't report file edits in this conversation. Try On Mac to see what's changed there."
          />
        ) : (
          <DiffSections sections={sections} viewOf={viewOf} onSetView={setView} />
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
          viewOf={viewOf}
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
  viewOf,
  onSetView,
  refreshControl,
}: {
  sections: FileSection[];
  viewOf: (section: FileSection) => FileView;
  onSetView: (key: string, view: FileView) => void;
  refreshControl?: ReactElement<RefreshControlProps>;
}) {
  const theme = useTheme();

  const visibleSections = useMemo(
    () =>
      sections.map((section) => {
        const view = viewOf(section);

        return {
          ...section,
          data:
            view === "collapsed"
              ? []
              : linesOf(section.file, view === "head" ? LINE_LIMIT : Number.POSITIVE_INFINITY),
        };
      }),
    [sections, viewOf],
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
        const collapsed = viewOf(section) === "collapsed";

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
              tintColor={theme.tertiary}
            />
          </html.button>
        );
      }}
      renderSectionFooter={({ section }) => {
        const hidden = section.lineCount - LINE_LIMIT;

        if (viewOf(section) !== "head" || hidden <= 0) return null;

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
