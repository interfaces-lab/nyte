import { isTerminalPhase } from "@nyte-ai/protocol";
import type { Failure, RunInfo, ToolProgress, ToolTurnPart, UserTurnPart } from "@nyte-ai/protocol";
import { livePartKey } from "@nyte-ai/client";
import type { SessionState } from "@nyte-ai/client";

export type ActivityPart =
  | { kind: "tool"; tool: ToolTurnPart; progress: ToolProgress | undefined }
  | { kind: "thinking"; id: string; text: string; streaming: boolean }
  | { kind: "progress"; id: string; progress: ToolProgress };

export type ChatRow =
  | { kind: "user"; id: string; content: UserTurnPart["content"]; delivery: "sent" | "queued" }
  | { kind: "assistant"; id: string; text: string; streaming: boolean }
  | { kind: "activity"; id: string; parts: readonly ActivityPart[] }
  | { kind: "status"; id: string; run: RunInfo }
  | { kind: "failure"; id: string; failure: Failure }
  | { kind: "summary"; id: string; text: string }
  | { kind: "marker"; id: string; text: string };

export function activityPartId(part: ActivityPart): string {
  return part.kind === "tool" ? part.tool.callId : part.id;
}

export function transcriptRows(items: SessionState["transcript"]["items"]): ChatRow[] {
  const rows: ChatRow[] = [];

  for (const item of items) {
    if (item.kind === "summary") {
      rows.push({ kind: "summary", id: item.commit, text: item.body.text });
      continue;
    }

    if (item.kind === "checkpoint") {
      rows.push({ kind: "marker", id: item.commit, text: "Earlier context summarized" });
      continue;
    }

    if (item.kind === "config") {
      if (item.body.model !== undefined)
        rows.push({
          kind: "marker",
          id: item.commit,
          text: `Model changed to ${item.body.model.id}`,
        });
      continue;
    }

    let group: ActivityPart[] | undefined;
    let groupIndex = 0;

    for (const part of item.parts) {
      if (part.kind === "tool" || part.kind === "thinking") {
        const activity: ActivityPart =
          part.kind === "tool"
            ? { kind: "tool", tool: part, progress: undefined }
            : {
                kind: "thinking",
                id: `thinking:${part.commit}:${part.contentIndex}`,
                text: part.text,
                streaming: false,
              };

        if (group === undefined) {
          group = [];
          rows.push({ kind: "activity", id: `activity:${item.id}:${groupIndex}`, parts: group });
          groupIndex += 1;
        }

        group.push(activity);
        continue;
      }

      group = undefined;

      if (part.kind === "user") {
        rows.push({
          kind: "user",
          id: part.key === undefined ? `message:${part.commit}` : `submission:${part.key}`,
          content: part.content,
          delivery: "sent",
        });
      } else {
        rows.push({
          kind: "assistant",
          id: `assistant:${part.commit}:${part.contentIndex}`,
          text: part.text,
          streaming: false,
        });
      }
    }

    if (item.failure !== undefined)
      rows.push({ kind: "failure", id: `failure:${item.id}`, failure: item.failure });
  }

  return rows;
}

export function conversationRows(committed: readonly ChatRow[], state: SessionState): ChatRow[] {
  const progress = new Map<string, ToolProgress>();

  for (const part of state.overlay) {
    if (part.kind === "tool") progress.set(part.callId, part.progress);
  }

  const represented = new Set<string>();

  const rows = committed.map((row) => {
    if (row.kind !== "activity" || progress.size === 0) return row;

    let parts: ActivityPart[] | undefined;

    for (const [index, part] of row.parts.entries()) {
      if (part.kind !== "tool") continue;
      const update = progress.get(part.tool.callId);

      if (update === undefined) continue;
      represented.add(part.tool.callId);

      if (update === part.progress) continue;
      parts ??= [...row.parts];
      parts[index] = { ...part, progress: update };
    }

    return parts === undefined ? row : { ...row, parts };
  });

  let group: ActivityPart[] | undefined;
  const turn = state.transcript.items.findLast((item) => item.kind === "turn");
  const activityPrefix = `activity:${turn?.id ?? state.run?.runId ?? "stream"}:`;

  let groupIndex = committed.filter(
    (row) => row.kind === "activity" && row.id.startsWith(activityPrefix),
  ).length;

  for (const part of state.overlay) {
    if (part.kind === "text") {
      group = undefined;
      rows.push({ kind: "assistant", id: livePartKey(part), text: part.text, streaming: true });
      continue;
    }

    if (part.kind === "tool" && represented.has(part.callId)) continue;

    const activity: ActivityPart =
      part.kind === "thinking"
        ? { kind: "thinking", id: livePartKey(part), text: part.text, streaming: true }
        : { kind: "progress", id: livePartKey(part), progress: part.progress };

    if (group === undefined) {
      const previous = rows.at(-1);
      group = previous?.kind === "activity" ? [...previous.parts] : [];

      if (previous?.kind === "activity") rows[rows.length - 1] = { ...previous, parts: group };
      else {
        rows.push({ kind: "activity", id: `${activityPrefix}${groupIndex}`, parts: group });
        groupIndex += 1;
      }
    }

    group.push(activity);
  }

  const run = state.run;

  if (run !== undefined) {
    const recordedFailure = state.transcript.items.some(
      (item) =>
        item.kind === "turn" &&
        item.run.kind === "run" &&
        item.run.id === run.runId &&
        item.failure !== undefined,
    );

    if (!isTerminalPhase(run.phase) || (run.phase.kind !== "done" && !recordedFailure))
      rows.push({ kind: "status", id: `status:${run.runId}`, run });
  }

  for (const pending of state.pending)
    rows.push({
      kind: "user",
      id: pending.key === undefined ? `message:${pending.change}` : `submission:${pending.key}`,
      content: pending.content,
      delivery: "queued",
    });

  return rows;
}
