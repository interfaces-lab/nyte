import { memo, useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, Text } from "react-native";
import { Host, RNHostView } from "@expo/ui";
import { BottomSheet, Group } from "@expo/ui/swift-ui";
import {
  presentationBackground,
  presentationDetents,
  presentationDragIndicator,
} from "@expo/ui/swift-ui/modifiers";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { LegendList } from "@legendapp/list/react-native";
import { SymbolView } from "expo-symbols";
import { css, html } from "react-strict-dom";
import type { SessionId, ToolClass, ToolOutcome } from "@nyte-ai/sdk";
import { toolStatus, toolTitle } from "@nyte-ai/plugin/client/presentation";
import type { ToolTense, ToolTone } from "@nyte-ai/plugin/client/presentation";
import { controls, radii, spacing, textStyles, tokens, useTheme } from "../theme.ts";
import { GlassButton } from "../ui/glass-button.tsx";
import { delegateName } from "./delegate-names.ts";
import { Markdown } from "./markdown.tsx";
import type { ActivityPart, ChatRow } from "./transcript-rows.ts";

export function useActivitySheet(rows: readonly ChatRow[]) {
  const [selected, setSelected] = useState<Extract<ChatRow, { kind: "activity" }>>();
  const [open, setOpen] = useState(false);
  const current = rows.find((row) => row.kind === "activity" && row.id === selected?.id);

  if (open && current?.kind === "activity" && current !== selected) setSelected(current);

  const openActivity = useCallback((row: Extract<ChatRow, { kind: "activity" }>) => {
    setSelected(row);
    setOpen(true);
  }, []);

  return { open, parts: selected?.parts ?? [], openActivity, close: () => setOpen(false) };
}

function activityTitle(
  toolClass: ToolClass,
  tense: ToolTense,
  names: ReadonlyMap<SessionId, string>,
): string {
  if (toolClass.kind === "shell" && toolClass.description !== undefined)
    return toolClass.description;

  return toolClass.kind === "delegate"
    ? toolTitle(toolClass, tense, delegateName(toolClass, names))
    : toolTitle(toolClass, tense);
}

function activityState(part: ActivityPart, names: ReadonlyMap<SessionId, string>) {
  if (part.kind === "thinking")
    return {
      title: part.streaming ? "Thinking" : "Thoughts",
      tone: part.streaming ? ("running" as const) : ("success" as const),
    };

  const status = toolStatus(part);
  const title = activityTitle(part.state.class, status.tense, names);

  return {
    title: status.word === undefined ? title : `${title} · ${status.word}`,
    tone: status.tone,
  };
}

export function activitySummary(
  parts: readonly ActivityPart[],
  names: ReadonlyMap<SessionId, string>,
) {
  const states = parts.map((part) => activityState(part, names));
  const attention = states.find((state) => state.tone === "attention");
  const active = states.findLast((state) => state.tone === "running");
  const failed = states.filter((state) => state.tone === "failure").length;

  if (attention !== undefined)
    return failed === 0
      ? attention
      : { ...attention, title: `${attention.title} · ${failed} failed` };

  if (failed > 0)
    return {
      title:
        active !== undefined
          ? `${active.title} · ${failed} failed`
          : states.length === 1
            ? (states[0]?.title ?? "Tool failed")
            : `${failed} ${failed === 1 ? "tool failed" : "tools failed"}`,
      tone: "failure" as const,
    };

  if (active !== undefined) return active;

  if (states.length === 1) return states[0] ?? { title: "Activity", tone: "success" as const };
  const stopped = states.filter((state) => state.tone === "stopped").length;

  if (stopped > 0)
    return {
      title: `${stopped} ${stopped === 1 ? "tool stopped" : "tools stopped"}`,
      tone: "stopped" as const,
    };

  const reads = new Set<string>();
  const edits = new Set<string>();
  const folders = new Set<string>();
  let commands = 0;
  let agents = 0;
  let other = 0;

  for (const part of parts) {
    if (part.kind !== "tool" || part.state.phase !== "settled" || part.state.outcome.kind !== "ok")
      continue;
    const tool = part.state.class;

    switch (tool.kind) {
      case "read":
        reads.add(tool.path);
        break;
      case "list":
        folders.add(tool.path);
        break;
      case "edit":
        edits.add(tool.path);
        break;
      case "shell":
        commands += 1;
        break;
      case "delegate":
        agents += 1;
        break;
      case "custom":
        other += 1;
        break;
      default: {
        const exhaustive: never = tool;

        return exhaustive;
      }
    }
  }

  const labels = [
    reads.size === 0 ? undefined : `Read ${reads.size} ${reads.size === 1 ? "file" : "files"}`,
    folders.size === 0
      ? undefined
      : `Listed ${folders.size} ${folders.size === 1 ? "folder" : "folders"}`,
    edits.size === 0 ? undefined : `Changed ${edits.size} ${edits.size === 1 ? "file" : "files"}`,
    commands === 0 ? undefined : `Ran ${commands} ${commands === 1 ? "command" : "commands"}`,
    agents === 0 ? undefined : `${agents} ${agents === 1 ? "agent action" : "agent actions"}`,
    other === 0 ? undefined : `${other} ${other === 1 ? "other action" : "other actions"}`,
  ].filter((label) => label !== undefined);

  return {
    title: labels.length === 0 ? "Thoughts" : labels.join(" · "),
    tone: "success" as const,
  };
}

export function ActivityIcon({ tone }: { tone: ToolTone }) {
  const theme = useTheme();

  if (tone === "running") return <ActivityIndicator size="small" color={theme.muted} />;

  return (
    <SymbolView
      name={
        tone === "failure"
          ? "exclamationmark.circle"
          : tone === "attention"
            ? "questionmark.circle"
            : tone === "stopped"
              ? "stop.circle"
              : "checkmark.circle"
      }
      size={16}
      tintColor={
        tone === "failure" ? theme.danger : tone === "attention" ? theme.accent : theme.muted
      }
    />
  );
}

function Output({ text }: { text: string }) {
  const theme = useTheme();

  return (
    <html.div style={styles.output}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator
        contentContainerStyle={{ padding: spacing.md }}
      >
        <Text
          selectable
          style={{ fontFamily: "Menlo", fontSize: 13, lineHeight: 19, color: theme.foreground }}
        >
          {text}
        </Text>
      </ScrollView>
    </html.div>
  );
}

function readOutput(outcome: ToolOutcome): string | undefined {
  switch (outcome.kind) {
    case "ok":
      return outcome.content
        .flatMap((item) => (item.kind === "text" ? [item.text] : []))
        .join("\n");
    case "failed":
      return outcome.message;
    case "rejected":
      return outcome.reason;
    case "interrupted":
    case "stopped":
      return undefined;
    default: {
      const exhaustive: never = outcome;

      return exhaustive;
    }
  }
}

/** Where a detail row leads once the sheet has dismissed. */
type Destination = { kind: "file"; path: string } | { kind: "session"; id: SessionId };

const ActivityDetail = memo(function ActivityDetail({
  part,
  delegateNames,
  onOpen,
}: {
  part: ActivityPart;
  delegateNames: ReadonlyMap<SessionId, string>;
  onOpen: (destination: Destination) => void;
}) {
  const state = activityState(part, delegateNames);
  const tool = part.kind === "tool" ? part.state : undefined;
  const progress = tool?.phase === "running" ? tool.progress?.text : undefined;
  const output = tool?.phase === "settled" ? readOutput(tool.outcome) : undefined;

  const file =
    tool?.phase === "settled" && tool.changes !== null && tool.class.kind === "edit"
      ? { path: tool.class.path, added: tool.changes.added, removed: tool.changes.removed }
      : undefined;

  const prose = tool?.class.kind === "custom" || tool?.class.kind === "delegate";
  const child = tool?.class.kind === "delegate" ? tool.class.child : null;

  return (
    <html.div style={styles.detail}>
      <html.div style={styles.detailHeader}>
        <ActivityIcon tone={state.tone} />
        <html.span
          style={[
            textStyles.headline,
            styles.detailTitle,
            state.tone === "failure" && styles.failed,
          ]}
        >
          {state.title}
        </html.span>
      </html.div>
      {tool?.class.kind === "shell" ? <Output text={`$ ${tool.class.command}`} /> : null}
      {part.kind === "thinking" ? <Markdown text={part.text} streaming={part.streaming} /> : null}
      {progress === undefined || progress === "" ? null : <Output text={progress} />}
      {output === undefined || output === "" ? null : prose ? (
        <Markdown text={output} />
      ) : (
        <Output text={output} />
      )}
      {file === undefined ? null : (
        <GlassButton
          label={`View changes · +${file.added} −${file.removed}`}
          systemImage="doc.text"
          onPress={() => onOpen({ kind: "file", path: file.path })}
        />
      )}
      {child === null ? null : (
        <GlassButton
          label="Open Conversation"
          systemImage="bubble.left.and.bubble.right"
          onPress={() => onOpen({ kind: "session", id: child })}
        />
      )}
    </html.div>
  );
});

export function ToolActivitySheet({
  open,
  parts,
  delegateNames,
  onClose,
  onOpenFile,
  onOpenSession,
}: {
  open: boolean;
  parts: readonly ActivityPart[];
  delegateNames: ReadonlyMap<SessionId, string>;
  onClose: () => void;
  onOpenFile: (path: string) => void;
  onOpenSession: (session: SessionId) => void;
}) {
  const theme = useTheme();
  const [pending, setPending] = useState<Destination>();

  return (
    <Host style={{ position: "absolute" }} pointerEvents="none">
      <BottomSheet
        isPresented={open}
        onIsPresentedChange={(presented) => {
          if (!presented) onClose();
        }}
        onDismiss={() => {
          if (pending === undefined) return;
          setPending(undefined);

          if (pending.kind === "file") onOpenFile(pending.path);
          else onOpenSession(pending.id);
        }}
      >
        <Group
          modifiers={[
            presentationDetents(["medium", "large"]),
            presentationDragIndicator("visible"),
            presentationBackground(theme.canvas),
          ]}
        >
          <RNHostView>
            <SafeAreaProvider>
              <SafeAreaView edges={["bottom"]} style={{ flex: 1, backgroundColor: theme.canvas }}>
                <html.div style={styles.header}>
                  <html.h1 style={[textStyles.title, styles.heading]}>Activity</html.h1>
                  <GlassButton
                    label="Close activity"
                    systemImage="xmark"
                    iconOnly
                    onPress={onClose}
                  />
                </html.div>
                <LegendList
                  data={parts}
                  keyExtractor={(part) => part.id}
                  getItemType={(part) => part.kind}
                  estimatedItemSize={180}
                  recycleItems={false}
                  style={{ flex: 1 }}
                  contentContainerStyle={{ paddingBottom: spacing.xl }}
                  renderItem={({ item }) => (
                    <ActivityDetail
                      part={item}
                      delegateNames={delegateNames}
                      onOpen={(destination) => {
                        setPending(destination);
                        onClose();
                      }}
                    />
                  )}
                />
              </SafeAreaView>
            </SafeAreaProvider>
          </RNHostView>
        </Group>
      </BottomSheet>
    </Host>
  );
}

const styles = css.create({
  header: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    padding: spacing.lg,
  },
  heading: { margin: 0 },
  detail: {
    display: "flex",
    flexDirection: "column",
    gap: spacing.md,
    padding: spacing.lg,
    borderBottomWidth: controls.hairline,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.separator,
  },
  detailHeader: { display: "flex", flexDirection: "row", alignItems: "center", gap: spacing.sm },
  detailTitle: { flex: 1 },
  failed: { color: tokens.danger },
  output: {
    borderRadius: radii.control,
    backgroundColor: tokens.incomingBubble,
    overflow: "hidden",
  },
});
