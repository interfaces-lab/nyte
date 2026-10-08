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
import { formatToolDuration, toolStatus } from "@nyte-ai/client";
import type { ToolTense, ToolTone } from "@nyte-ai/client";
import type { SessionId, TurnToolClass } from "@nyte-ai/protocol";
import { controls, radii, spacing, textStyles, tokens, useTheme } from "../theme.ts";
import { GlassButton } from "../ui/glass-button.tsx";
import { delegateTitle } from "./delegate-names.ts";
import { Markdown } from "./markdown.tsx";
import { activityPartId } from "./transcript-rows.ts";
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

type Verbs = Readonly<Record<Exclude<ToolTense, "none">, string>>;

function titled(verbs: Verbs, tense: ToolTense, subject: string): string {
  return tense === "none" ? subject : `${verbs[tense]} ${subject}`;
}

function toolTitle(
  toolClass: TurnToolClass,
  tense: ToolTense,
  names: ReadonlyMap<SessionId, string>,
): string {
  switch (toolClass.kind) {
    case "file_read":
      return titled({ running: "Reading", past: "Read" }, tense, toolClass.path);
    case "list":
      return titled({ running: "Listing", past: "Listed" }, tense, toolClass.path);
    case "shell":
      return (
        toolClass.description ??
        titled({ running: "Running", past: "Ran" }, tense, toolClass.command)
      );
    case "file_edit":
      return titled({ running: "Editing", past: "Edited" }, tense, toolClass.path);
    case "file_write":
      return titled({ running: "Writing", past: "Wrote" }, tense, toolClass.path);
    case "file_patch":
      return titled(
        toolClass.op === "edit"
          ? { running: "Editing", past: "Edited" }
          : { running: "Writing", past: "Wrote" },
        tense,
        toolClass.path,
      );
    case "delegate":
      return delegateTitle(toolClass, tense, names);
    case "custom":
      return titled({ running: "Running", past: "Ran" }, tense, toolClass.label);
    default: {
      const exhaustive: never = toolClass;

      return exhaustive;
    }
  }
}

function activityState(part: ActivityPart, names: ReadonlyMap<SessionId, string>) {
  if (part.kind === "thinking")
    return {
      title: part.streaming ? "Thinking" : "Thoughts",
      tone: part.streaming ? ("running" as const) : ("success" as const),
    };

  if (part.kind === "progress")
    return { title: part.progress.title ?? "Working", tone: "running" as const };

  const status = toolStatus(part.tool.state);
  const title = part.progress?.title ?? toolTitle(part.tool.class, status.tense, names);

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
    if (part.kind !== "tool" || part.tool.state.kind !== "success") continue;
    const tool = part.tool.class;

    switch (tool.kind) {
      case "file_read":
        reads.add(tool.path);
        break;
      case "list":
        folders.add(tool.path);
        break;
      case "file_edit":
      case "file_write":
      case "file_patch":
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

const ActivityDetail = memo(function ActivityDetail({
  part,
  delegateNames,
  onOpenFile,
}: {
  part: ActivityPart;
  delegateNames: ReadonlyMap<SessionId, string>;
  onOpenFile: ((path: string) => void) | undefined;
}) {
  const state = activityState(part, delegateNames);
  const tool = part.kind === "tool" ? part.tool : undefined;
  const progress = part.kind === "thinking" ? undefined : part.progress;
  const output = tool?.output;

  const file =
    tool?.class.kind === "file_patch" && tool.state.kind === "success" ? tool.class : undefined;

  const prose = tool?.class.kind === "custom" || tool?.class.kind === "delegate";

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
      {tool?.class.kind === "shell" && tool.class.facts !== undefined ? (
        <html.span style={textStyles.caption}>
          {formatToolDuration(tool.class.facts.durationMs)}
        </html.span>
      ) : null}
      {part.kind === "thinking" ? <Markdown text={part.text} streaming={part.streaming} /> : null}
      {progress === undefined || progress.text === "" ? null : <Output text={progress.text} />}
      {output === undefined || output === "" ? null : prose ? (
        <Markdown text={output} />
      ) : (
        <Output text={output} />
      )}
      {file === undefined || onOpenFile === undefined ? null : (
        <GlassButton
          label={`View changes · +${file.added} −${file.removed}`}
          systemImage="doc.text"
          onPress={() => onOpenFile(file.path)}
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
}: {
  open: boolean;
  parts: readonly ActivityPart[];
  delegateNames: ReadonlyMap<SessionId, string>;
  onClose: () => void;
  onOpenFile?: (path: string) => void;
}) {
  const theme = useTheme();
  const [pendingFile, setPendingFile] = useState<string>();

  return (
    <Host style={{ position: "absolute" }} pointerEvents="none">
      <BottomSheet
        isPresented={open}
        onIsPresentedChange={(presented) => {
          if (!presented) onClose();
        }}
        onDismiss={() => {
          if (pendingFile === undefined) return;
          setPendingFile(undefined);
          onOpenFile?.(pendingFile);
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
                  keyExtractor={activityPartId}
                  getItemType={(part) => part.kind}
                  estimatedItemSize={180}
                  recycleItems={false}
                  style={{ flex: 1 }}
                  contentContainerStyle={{ paddingBottom: spacing.xl }}
                  renderItem={({ item }) => (
                    <ActivityDetail
                      part={item}
                      delegateNames={delegateNames}
                      onOpenFile={
                        onOpenFile === undefined
                          ? undefined
                          : (path) => {
                              setPendingFile(path);
                              onClose();
                            }
                      }
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
