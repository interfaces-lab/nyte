import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList } from "react-native";
import { SymbolView } from "expo-symbols";
import { css, html } from "react-strict-dom";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NyteClient } from "@nyte-ai/client";
import type { FileChange, RunId, SessionId, VcsDiff } from "@nyte-ai/protocol";
import { EmptyState } from "../ui/empty-state.tsx";
import { GlassButton } from "../ui/glass-button.tsx";
import { describeHostError } from "../connection/connection.ts";
import { controls, nativeTheme, spacing, textStyles, tokens } from "../theme.ts";

type ChangesScreenProps = {
  client: NyteClient;
  sessionId: SessionId;
  runId: RunId | undefined;
  onBack: () => void;
};

type ReviewState =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "files"; files: readonly FileChange[] }
  | { kind: "diff"; diffs: readonly VcsDiff[] };

export function ChangesScreen(props: ChangesScreenProps) {
  return <ChangesReview key={JSON.stringify([props.sessionId, props.runId])} {...props} />;
}

function ChangesReview({ client, sessionId, runId, onBack }: ChangesScreenProps) {
  const insets = useSafeAreaInsets();
  const [path, setPath] = useState<string>();
  const [revision, setRevision] = useState(0);
  return (
    <html.div data-layoutconformance="strict" style={styles.screen}>
      <html.div style={[styles.header, styles.topInset(insets.top)]}>
        <GlassButton
          label={path === undefined ? "Back to conversation" : "Back to changed files"}
          onPress={path === undefined ? onBack : () => setPath(undefined)}
          systemImage="chevron.left"
          iconOnly
        />
        <html.h1 style={[textStyles.title, styles.heading]}>
          {path === undefined ? "Changed files" : "Workspace diff"}
        </html.h1>
        <GlassButton
          label={path === undefined ? "Refresh changed files" : "Refresh current workspace diff"}
          onPress={() => setRevision((value) => value + 1)}
          systemImage="arrow.clockwise"
          iconOnly
        />
      </html.div>
      <html.div style={[styles.content, styles.bottomInset(insets.bottom)]}>
        {path === undefined ? (
          <html.p style={[textStyles.caption, styles.description]}>
            {runId === undefined
              ? "Files changed in this conversation"
              : "Files changed during this run"}
          </html.p>
        ) : (
          <html.div style={styles.description}>
            <html.p style={textStyles.code}>{path}</html.p>
            <html.p style={textStyles.caption}>
              Shows this file's current changes on your Mac, not a saved record from this chat. It
              can include later or unrelated edits.
            </html.p>
          </html.div>
        )}
        <ReviewContent
          key={JSON.stringify([path, revision])}
          client={client}
          sessionId={sessionId}
          runId={runId}
          path={path}
          onSelect={setPath}
          onRetry={() => setRevision((value) => value + 1)}
        />
      </html.div>
    </html.div>
  );
}

function ReviewContent({
  client,
  sessionId,
  runId,
  path,
  onSelect,
  onRetry,
}: Omit<ChangesScreenProps, "onBack"> & {
  path: string | undefined;
  onSelect: (path: string) => void;
  onRetry: () => void;
}) {
  const [state, setState] = useState<ReviewState>({ kind: "loading" });
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const result =
          path === undefined
            ? { kind: "files" as const, files: await client.runs.changes({ sessionId, runId }) }
            : { kind: "diff" as const, diffs: await client.workspace.vcs.diff({ paths: [path] }) };
        if (active) setState(result);
      } catch (cause) {
        if (active) setState({ kind: "failed", message: describeHostError(cause) });
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [client, sessionId, runId, path]);

  if (state.kind === "loading")
    return (
      <html.div style={styles.notice}>
        <ActivityIndicator color={nativeTheme.muted} />
        <html.p style={textStyles.secondary} aria-live="polite">
          Loading {path === undefined ? "changed files" : "workspace diff"}…
        </html.p>
      </html.div>
    );
  if (state.kind === "failed")
    return (
      <html.div style={styles.notice}>
        <html.p role="alert" style={textStyles.error}>
          {state.message}
        </html.p>
        <GlassButton label="Try again" onPress={onRetry} />
      </html.div>
    );
  if (state.kind === "files")
    return (
      <FlatList
        data={state.files}
        keyExtractor={(file) => file.path}
        renderItem={({ item }) => (
          <html.button
            aria-label={`${item.path}, ${item.added} added, ${item.removed} removed. View current workspace diff`}
            onClick={() => onSelect(item.path)}
            style={styles.file}
          >
            <SymbolView name="doc.text" size={controls.icon} tintColor={nativeTheme.muted} />
            <html.p style={[textStyles.code, styles.heading]}>{item.path}</html.p>
            <html.span style={[textStyles.caption, styles.added]}>+{item.added}</html.span>
            <html.span style={[textStyles.caption, styles.removed]}>−{item.removed}</html.span>
            <SymbolView name="chevron.right" size={controls.iconSm} tintColor={nativeTheme.muted} />
          </html.button>
        )}
        ListEmptyComponent={
          <html.div style={styles.empty}>
            <EmptyState
              title="No changes yet"
              description={
                runId === undefined
                  ? "No files have changed in this chat."
                  : "No files changed during this run."
              }
            />
          </html.div>
        }
      />
    );
  const patch = state.diffs.find((diff) => diff.path === path)?.patch;
  if (!patch)
    return (
      <html.div style={styles.empty}>
        <EmptyState
          title="No diff to show"
          description="Your Mac has no readable changes for this file now. They may have been committed or undone."
        />
      </html.div>
    );
  return (
    <FlatList
      data={patch.split("\n")}
      keyExtractor={(_, index) => String(index)}
      contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }}
      renderItem={({ item }) => (
        <html.p
          style={[
            textStyles.code,
            styles.diffLine,
            item.startsWith("+") && !item.startsWith("+++") ? styles.added : null,
            item.startsWith("-") && !item.startsWith("---") ? styles.removed : null,
            item.startsWith("@@") ? styles.hunk : null,
          ]}
        >
          {item || " "}
        </html.p>
      )}
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
  header: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    paddingInline: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  topInset: (top: number) => ({ paddingTop: top + spacing.xs }),
  bottomInset: (bottom: number) => ({ paddingBottom: bottom }),
  heading: { flexGrow: 1, flexShrink: 1 },
  content: { flexGrow: 1, flexBasis: 0, minHeight: 0 },
  description: { padding: spacing.lg, gap: spacing.sm },
  empty: { paddingInline: spacing.lg },
  notice: { padding: spacing.xl, gap: spacing.md, alignItems: "center" },
  file: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: controls.touchTarget,
    padding: spacing.lg,
    borderWidth: 0,
    borderBottomWidth: controls.borderWidth,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.border,
    backgroundColor: { default: tokens.background, ":active": tokens.surface },
  },
  diffLine: { whiteSpace: "pre-wrap" },
  added: { color: tokens.success },
  removed: { color: tokens.danger },
  hunk: { color: tokens.accent },
});
