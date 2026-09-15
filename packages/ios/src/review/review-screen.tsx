import { router } from "expo-router";
import { randomUUID } from "expo-crypto";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, useWindowDimensions } from "react-native";
import { css, html } from "react-strict-dom";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SessionId } from "@nyte-ai/protocol";
import { isTerminalPhase } from "@nyte-ai/protocol";
import { sessionMark, waitingCall } from "@nyte-ai/core/client";
import { useHost } from "../connection/host-context.tsx";
import { EmptyState } from "../ui/empty-state.tsx";
import { GlassButton } from "../ui/glass-button.tsx";
import { SectionHeader } from "../ui/section-header.tsx";
import { Group, GroupRow } from "../ui/group.tsx";
import { IconTile } from "../ui/icon-tile.tsx";
import { describeHostError } from "../connection/connection.ts";
import { statusLabels, formatActivity, markTone } from "../chat/sessions.ts";
import { conversationChanges, formatDuration, latestChangedTurn } from "../chat/turn-changes.ts";
import { confirmMergeRequest, MERGE_PROMPT } from "../chat/merge-request.ts";
import { useRemoteChat } from "../chat/remote-chat.ts";
import { Markdown } from "../chat/messages.tsx";
import {
  controls,
  list,
  useTheme,
  radii,
  spacing,
  textStyles,
  tokens,
  typography,
} from "../theme.ts";

function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash <= 0 ? "" : path.slice(0, slash);
}

function basenameOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(slash + 1);
}

export function ReviewScreen({ sessionId }: { sessionId: SessionId }) {
  const theme = useTheme();
  const { client } = useHost();
  const insets = useSafeAreaInsets();
  const chat = useRemoteChat(client, sessionId);
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string>();
  const [now] = useState(() => Date.now());
  const summaryWidth = useWindowDimensions().width - list.gutter * 2;

  const changes = useMemo(
    () => conversationChanges(chat.state?.transcript.items ?? []),
    [chat.state],
  );
  const changedTurn = useMemo(
    () => latestChangedTurn(chat.state?.transcript.items ?? []),
    [chat.state],
  );
  const summary = useMemo(() => {
    if (changedTurn === undefined || changedTurn.kind !== "turn") return undefined;
    const texts = changedTurn.parts
      .filter((part) => part.kind === "assistant")
      .map((part) => (part.kind === "assistant" ? part.text : ""));
    return texts.length === 0 ? undefined : texts[texts.length - 1];
  }, [changedTurn]);

  const info = chat.state?.info;
  const run = chat.state?.run;
  const waiting = chat.state === undefined ? undefined : waitingCall(chat.state);
  const running = run !== undefined && !isTerminalPhase(run.phase);
  const mark = info === undefined ? "idle" : sessionMark(info);
  const added = changes.reduce((total, file) => total + file.added, 0);
  const removed = changes.reduce((total, file) => total + file.removed, 0);
  const tone = markTone(mark, theme);
  const outcome =
    run?.phase.kind === "done"
      ? "completed"
      : run?.phase.kind === "aborted"
        ? "aborted"
        : run?.phase.kind === "failed"
          ? "failed"
          : undefined;

  // One decision drives the headline, its symbol, its tint, and the detail line,
  // so the four can never describe different states.
  const readiness: { headline: string; symbol: SFSymbol; tint: string; detail: string } = running
    ? {
        headline: "Agent is working",
        symbol: "clock",
        tint: theme.muted,
        detail: `${statusLabels[mark]}${run === undefined ? "" : ` \u00b7 ${formatDuration(now - run.startedAt)}`}`,
      }
    : waiting !== undefined
      ? {
          headline: "Needs your answer",
          symbol: "questionmark.circle.fill",
          tint: theme.warning,
          detail: "Waiting for your answer",
        }
      : changes.length === 0
        ? {
            headline: "No file changes",
            symbol: "doc",
            tint: theme.muted,
            detail: "The agent hasn't edited files in this conversation.",
          }
        : outcome === "failed"
          ? {
              headline: "Failed with changes",
              symbol: "xmark.circle.fill",
              tint: theme.danger,
              detail: "The run failed.",
            }
          : outcome === "aborted"
            ? {
                headline: "Stopped with changes",
                symbol: "stop.circle.fill",
                tint: theme.muted,
                detail: "Stopped. Check the diff first.",
              }
            : {
                headline: "Ready for review",
                symbol: "checkmark.circle.fill",
                tint: theme.success,
                detail:
                  changedTurn === undefined
                    ? "Finished"
                    : `Finished in ${formatDuration(changedTurn.durationMs)}`,
              };

  async function merge() {
    if (merging) return;
    setMerging(true);
    setMergeError(undefined);
    try {
      await client.messages.send({ sessionId, content: MERGE_PROMPT, key: randomUUID() });
      router.back();
    } catch (cause) {
      setMergeError(describeHostError(cause));
    } finally {
      setMerging(false);
    }
  }

  if (chat.state === undefined) {
    return (
      <html.div style={[styles.centered, styles.topInset(insets.top)]}>
        {chat.error !== undefined ? (
          <EmptyState title="Couldn't load review" description={chat.error} />
        ) : (
          <ActivityIndicator color={theme.muted} />
        )}
      </html.div>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={{ flexGrow: 1 }}
      contentInsetAdjustmentBehavior="automatic"
    >
      <html.div style={[styles.page, styles.bottomInset(insets.bottom)]}>
        <html.h1 style={[textStyles.heading, styles.title]}>
          {info?.name || "Untitled conversation"}
        </html.h1>
        <html.div style={styles.statusRow}>
          <html.div style={styles.pill(tone)}>
            <html.span style={styles.pillText(tone)}>{statusLabels[mark]}</html.span>
          </html.div>
          <html.span style={[textStyles.secondary, styles.totals]}>
            <html.span style={styles.added}>{`+${String(added)} `}</html.span>
            <html.span style={styles.removed}>{`\u2212${String(removed)}`}</html.span>
            {` \u00b7 ${String(changes.length)} ${changes.length === 1 ? "file" : "files"}`}
          </html.span>
          <html.div style={styles.rule} />
          <html.span style={textStyles.secondary}>
            {info === undefined
              ? ""
              : formatActivity(info.lastActivityAt, now) === "Now"
                ? "Just now"
                : `${formatActivity(info.lastActivityAt, now)} ago`}
          </html.span>
        </html.div>
        <html.div style={styles.readiness}>
          <html.span style={textStyles.headline}>{readiness.headline}</html.span>
          <html.div style={styles.evidence}>
            <SymbolView name={readiness.symbol} size={controls.icon} tintColor={readiness.tint} />
            <html.span style={textStyles.secondary}>{readiness.detail}</html.span>
          </html.div>
          {mergeError !== undefined && (
            <html.p role="alert" style={textStyles.error}>
              {mergeError}
            </html.p>
          )}
          {waiting !== undefined ? (
            <GlassButton label="Answer in chat" prominent fill onPress={() => router.back()} />
          ) : changes.length > 0 ? (
            <>
              <GlassButton
                label={merging ? "Asking Nyte to merge…" : "Ask to merge"}
                disabled={running || merging}
                prominent
                fill
                onPress={() => confirmMergeRequest({ onSend: () => void merge() })}
              />
              <html.p style={textStyles.caption}>
                Sends a follow-up to the agent on your Mac. It runs git there and replies in the
                conversation.
              </html.p>
            </>
          ) : null}
        </html.div>
        {changes.length > 0 && (
          <>
            <SectionHeader label="Changed files" first />
            <Group>
              {changes.map((file) => (
                <GroupRow
                  key={file.path}
                  onClick={() =>
                    router.push(`/changes/${sessionId}?path=${encodeURIComponent(file.path)}`)
                  }
                >
                  <IconTile name="doc.text" />
                  <html.div style={styles.fileText}>
                    <html.span style={[textStyles.secondary, styles.fileName]}>
                      {basenameOf(file.path)}
                    </html.span>
                    <html.span style={textStyles.caption}>{folderOf(file.path)}</html.span>
                  </html.div>
                  <html.span style={[textStyles.caption, styles.totals]}>
                    <html.span style={styles.added}>{`+${String(file.added)} `}</html.span>
                    <html.span style={styles.removed}>{`\u2212${String(file.removed)}`}</html.span>
                  </html.span>
                  <SymbolView
                    name="chevron.right"
                    size={13}
                    weight="semibold"
                    tintColor={theme.tertiary}
                  />
                </GroupRow>
              ))}
            </Group>
          </>
        )}
        {summary !== undefined && summary !== "" && (
          <>
            <SectionHeader label="Agent summary" />
            <Markdown text={summary} width={summaryWidth} />
          </>
        )}
      </html.div>
    </ScrollView>
  );
}

const styles = css.create({
  page: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    paddingInline: list.gutter,
    paddingTop: spacing.md,
    gap: spacing.lg,
  },
  bottomInset: (bottom: number) => ({ paddingBottom: bottom + spacing.lg }),
  centered: {
    flexGrow: 1,
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.lg,
    padding: spacing.xl,
    backgroundColor: tokens.background,
  },
  topInset: (top: number) => ({ paddingTop: top + spacing.xl }),
  title: { lineClamp: 3, textAlign: "start" },
  statusRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  pill: (tone: { color: string; fill: string }) => ({
    height: 26,
    paddingInline: 10,
    borderRadius: radii.pill,
    backgroundColor: tone.fill,
    justifyContent: "center",
  }),
  pillText: (tone: { color: string; fill: string }) => ({
    ...typography.label,
    lineHeight: `${typography.label.lineHeight}px`,
    color: tone.color,
  }),
  totals: { fontVariant: "tabular-nums" },
  added: { color: tokens.success },
  removed: { color: tokens.danger },
  rule: { width: 1, height: 14, backgroundColor: tokens.separator },
  readiness: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.md,
    padding: spacing.lg,
    backgroundColor: tokens.surface,
    borderRadius: radii.card,
    borderWidth: controls.hairline,
    borderStyle: "solid",
    borderColor: tokens.border,
    boxShadow: tokens.shadow,
  },
  evidence: { display: "flex", flexDirection: "row", alignItems: "center", gap: spacing.sm },
  fileText: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    alignItems: "flex-start",
    gap: 2,
  },
  fileName: {
    color: tokens.foreground,
    lineClamp: 1,
    fontWeight: 600,
    textAlign: "start",
  },
});
