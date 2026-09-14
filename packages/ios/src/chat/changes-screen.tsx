import { useEffect, useMemo, useState, type ReactElement } from "react";
import type { RefreshControlProps } from "react-native";
import { ActivityIndicator, RefreshControl, SectionList } from "react-native";
import { SymbolView } from "expo-symbols";
import { css, html } from "react-strict-dom";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Host, Picker, Text } from "@expo/ui/swift-ui";
import { pickerStyle, tag } from "@expo/ui/swift-ui/modifiers";
import type { NyteClient } from "@nyte-ai/client";
import type { SessionId, VcsDiff } from "@nyte-ai/protocol";
import { parsePatchFacts, type PatchFile } from "@nyte-ai/core/views";
import { EmptyState } from "../ui/empty-state.tsx";
import { PrimaryButton } from "../ui/primary-button.tsx";
import { describeHostError } from "../connection/connection.ts";
import { useRemoteChat } from "./remote-chat.ts";
import { fileStatus, recordedEdits, type RecordedEdit } from "./turn-changes.ts";
import {
  controls,
  useTheme,
  spacing,
  textStyles,
  tokens,
} from "../theme.ts";

type Source = "agent" | "mac";

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
  lines: Line[];
  truncated: boolean;
};

const EXPANDED_LINE_LIMIT = 400;

/** Parsed patch → display lines with new-side (or old-side) line numbers. */
function linesOf(file: PatchFile): Line[] {
  const out: Line[] = [];
  for (const hunk of file.hunks) {
    out.push({
      kind: "hunk",
      text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
    });
    let oldLine = hunk.oldStart;
    let newLine = hunk.newStart;
    for (const raw of hunk.lines) {
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

function fileSection(
  file: PatchFile,
  path: string,
  subtitle: string | undefined,
  expanded: boolean,
): FileSection {
  const lines = linesOf(file);
  return {
    key: path + (subtitle ?? ""),
    path,
    status: fileStatus(file),
    added: file.added,
    removed: file.removed,
    subtitle,
    lines,
    truncated: !expanded && lines.length > EXPANDED_LINE_LIMIT,
  };
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
  // Sections past three start collapsed; user taps flip the default per file.
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  const [pulling, setPulling] = useState(false);
  const [macRevision, setMacRevision] = useState(0);
  const [macDiffs, setMacDiffs] = useState<
    | { kind: "loading" }
    | { kind: "failed"; message: string }
    | { kind: "ready"; diffs: readonly VcsDiff[] }
  >({ kind: "loading" });
  const chat = useRemoteChat(client, sessionId);
  const edits = useMemo(() => recordedEdits(chat.state?.transcript.items ?? []), [chat.state]);
  const conversationPaths = useMemo(() => [...edits.keys()], [edits]);

  useEffect(() => {
    if (source !== "mac") return;
    let active = true;
    void client.workspace.vcs
      .diff({ paths: conversationPaths.length === 0 ? undefined : conversationPaths })
      .then((diffs) => {
        if (active) {
          setMacDiffs({ kind: "ready", diffs });
          setPulling(false);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setMacDiffs({ kind: "failed", message: describeHostError(cause) });
          setPulling(false);
        }
      });
    return () => {
      active = false;
    };
  }, [client, source, macRevision, conversationPaths]);

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
              true,
            ),
          );
        });
      }
      return out;
    }
    if (macDiffs.kind !== "ready") return [];
    const out: FileSection[] = [];
    for (const diff of macDiffs.diffs) {
      const facts = parsePatchFacts(diff.patch);
      if (facts === undefined) continue;
      for (const file of facts.files) {
        const path = file.path ?? diff.path;
        out.push(fileSection(file, path, undefined, conversationPaths.length <= 3));
      }
    }
    return out;
  }, [source, edits, macDiffs, conversationPaths]);

  const isCollapsed = (section: FileSection) =>
    (sections.length > 3 && section.path !== initialPath) !== toggled.has(section.key);
  const toggle = (key: string) =>
    setToggled((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const agentEmpty = chat.state !== undefined && edits.size === 0;

  return (
    <html.div data-layoutconformance="strict" style={styles.screen}>
      <Host style={{ marginHorizontal: spacing.gutter, marginTop: spacing.sm }}>
        <Picker
          selection={source === "agent" ? 0 : 1}
          onSelectionChange={(selection) => setSource(selection === 1 ? "mac" : "agent")}
          modifiers={[pickerStyle("segmented")]}
        >
          <Text modifiers={[tag(0)]}>Agent edits</Text>
          <Text modifiers={[tag(1)]}>On Mac</Text>
        </Picker>
      </Host>
      <html.p style={[textStyles.caption, styles.caption]}>
        {source === "agent"
          ? "Edits the agent reported. Commands that changed files outside edit tools aren't included."
          : "Current uncommitted changes on your Mac for these files. Can include edits made outside this conversation."}
      </html.p>
      {source === "agent" ? (
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
          <DiffSections sections={sections} isCollapsed={isCollapsed} onToggle={toggle} />
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
          <PrimaryButton
            label="Try again"
            tone="secondary"
            onClick={() => setMacRevision((v) => v + 1)}
          />
        </html.div>
      ) : sections.length === 0 ? (
        <EmptyState
          title="Nothing changed on your Mac"
          description="Not changed on your Mac now. It may have been committed or undone."
        />
      ) : (
        <DiffSections
          sections={sections}
          isCollapsed={isCollapsed}
          onToggle={toggle}
          refreshControl={
            <RefreshControl
              tintColor={theme.muted}
              refreshing={pulling}
              onRefresh={() => {
                setPulling(true);
                setMacDiffs({ kind: "loading" });
                setMacRevision((v) => v + 1);
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
  isCollapsed,
  onToggle,
  refreshControl,
}: {
  sections: FileSection[];
  isCollapsed: (section: FileSection) => boolean;
  onToggle: (key: string) => void;
  refreshControl?: ReactElement<RefreshControlProps>;
}) {
  const theme = useTheme();
  return (
    <SectionList
      sections={sections.map((section) => ({
        ...section,
        data: isCollapsed(section) ? [] : section.lines,
      }))}
      keyExtractor={(item: Line, index: number) =>
        item.kind === "hunk"
          ? `hunk-${String(index)}-${item.text}`
          : `${String(index)}-${item.kind}`
      }
      stickySectionHeadersEnabled
      refreshControl={refreshControl}
      contentContainerStyle={{ paddingBottom: spacing.xl }}
      renderSectionHeader={({ section }) => {
        const file = section as FileSection;
        const collapsedNow = isCollapsed(file);
        return (
          <html.button
            aria-expanded={!collapsedNow}
            onClick={() => onToggle(file.key)}
            style={styles.fileHeader}
          >
            <html.div style={styles.badge}>
              <html.span style={styles.badgeText}>{file.status}</html.span>
            </html.div>
            <html.div style={styles.fileHeaderText}>
              <html.span style={[textStyles.secondary, styles.fileName]}>
                {file.path.split("/").pop()}
              </html.span>
              <html.span style={textStyles.caption}>
                {file.subtitle ?? file.path.split("/").slice(0, -1).join("/")}
              </html.span>
            </html.div>
            <html.span style={[textStyles.caption, styles.totals]}>
              {`+${String(file.added)} \u2212${String(file.removed)}`}
            </html.span>
            <SymbolView
              name={collapsedNow ? "chevron.down" : "chevron.up"}
              size={13}
              weight="semibold"
              tintColor={theme.tertiary}
            />
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
  screen: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    backgroundColor: tokens.background,
  },
  caption: { paddingInline: spacing.gutter, paddingBlock: spacing.sm },
  state: { paddingBlock: spacing.xxl, alignItems: "center", gap: spacing.md },
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
  fileHeaderText: { flexGrow: 1, flexShrink: 1, minWidth: 0, alignItems: "flex-start", gap: 1 },
  fileName: { color: tokens.foreground, fontWeight: 600, lineClamp: 1 },
  totals: { fontVariant: "tabular-nums", flexShrink: 0 },
  badge: {
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
