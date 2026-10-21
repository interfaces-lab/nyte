import type { Message } from "@nyte-ai/sdk";
import {
  failureNotice,
  formatDuration,
  readRawPart,
  showsReport,
  showsText,
  showsThinking,
  showsTool,
  shownContent,
  toolOutput,
  toolStatus,
} from "@nyte-ai/plugin/client/presentation";
import { ACTIVITY_WORKED_LABEL, GLYPHS, RECOVERY_STEPS } from "../lib/constants.ts";
import { userText } from "../lib/format.ts";
import type { Task } from "../lib/tasks.ts";
import { shellCard, toolCard } from "../lib/tool-card.ts";
import type { TranscriptModel, TurnStatus } from "../model/transcript.ts";

export interface MiniEntry {
  readonly key: string;
  readonly content: string;
  readonly style: "answer" | "user" | "tool" | "error" | "warning" | "dim";
}

export interface MiniPlan {
  readonly ready: readonly MiniEntry[];
  readonly live: readonly MiniEntry[];
  readonly path: readonly string[];
  readonly status: TurnStatus | null;
}

function messageEntry(message: Message, tasks: readonly Task[]): MiniEntry | null {
  if (message.kind === "user") {
    const mark = message.status.kind === "landed" ? GLYPHS.prompt : GLYPHS.ellipsis;

    return {
      key: message.id,
      content: `${showsReport(message) ? "↳" : mark} ${userText(shownContent(message))}`,
      style: "user",
    };
  }

  if (showsThinking(message)) return null;

  if (showsText(message))
    return { key: message.id, content: message.state.markdown, style: "answer" };

  if (showsTool(message)) {
    const failed = toolStatus(message).tone === "failure";

    const heading = toolCard(message, tasks, false)
      .heading.map((chunk) => chunk.text)
      .join("");

    const output = failed ? toolOutput(message.state) : "";

    return {
      key: message.id,
      content: output === "" || heading.includes(output) ? heading : `${heading}\n${output}`,
      style: failed ? "error" : "tool",
    };
  }

  return {
    key: message.id,
    content: `${message.partKind}\n${readRawPart(message).body}`,
    style: "dim",
  };
}

export function projectMiniTranscript(model: TranscriptModel, tasks: readonly Task[]): MiniPlan {
  const ready: MiniEntry[] = [];
  const live: MiniEntry[] = [];
  const path: string[] = [];
  let held = false;
  let status: TurnStatus | null = null;

  const append = (message: Message): void => {
    if (
      (message.kind === "user" && message.status.kind === "landed") ||
      (message.kind === "part" && message.status.kind === "settled")
    )
      path.push(message.id);
    const entry = messageEntry(message, tasks);

    if (entry === null) return;

    if (
      (message.kind === "user" && message.status.kind !== "landed") ||
      (message.kind === "part" &&
        (message.status.kind === "live" || message.status.kind === "waiting"))
    )
      held = true;

    if (entry.content !== "") (held ? live : ready).push(entry);
  };

  for (const row of model.rows) {
    switch (row.kind) {
      case "prompt":
        append(row.message);
        break;
      case "shell": {
        const running = row.job.state.kind === "running";

        if (running) held = true;
        const card = shellCard(row.job, row.job.startedAt, false);
        const failed = card.heading.some((chunk) => chunk.role === "error");
        const heading = card.heading.map((chunk) => chunk.text).join("");
        (held ? live : ready).push({
          key: `shell:${row.job.id}`,
          content: failed ? `${heading}\n${row.job.output}` : heading,
          style: failed ? "error" : "tool",
        });
        break;
      }

      case "turn": {
        for (const message of row.turn.blocks) append(message);
        const current = row.turn.status;
        status = current;

        if (current?.kind !== "settled") break;
        const notice = current.failure === null ? null : failureNotice(current.failure);
        const recovery = notice?.recovery;
        (held ? live : ready).push({
          key: `turn:${row.turn.info.id}`,
          content:
            notice === null
              ? `${ACTIVITY_WORKED_LABEL}${current.durationMs === null ? "" : ` for ${formatDuration(current.durationMs)}`}`
              : `${notice.text}${recovery === undefined ? "" : ` ${RECOVERY_STEPS[recovery]}`}`,
          style: notice === null ? "dim" : notice.tone === "danger" ? "error" : "warning",
        });
        break;
      }

      default: {
        const exhaustive: never = row;

        return exhaustive;
      }
    }
  }

  return { ready, live, path, status };
}
