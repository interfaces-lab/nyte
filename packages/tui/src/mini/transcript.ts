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
import type { HeadingChunk } from "../lib/tool-card.ts";
import type { TranscriptModel, TurnStatus } from "../model/transcript.ts";

/**
 * One block of the minimal transcript. Tools and notes are styled lines; tools sit together
 * without a blank row between them, every other pair of blocks has one.
 */
export type MiniEntry =
  | { readonly key: string; readonly kind: "answer"; readonly markdown: string }
  | { readonly key: string; readonly kind: "user"; readonly mark: string; readonly text: string }
  | {
      readonly key: string;
      readonly kind: "tool" | "note";
      readonly chunks: readonly HeadingChunk[];
    };

/** A turn that took less than this ends without a "Worked for" line; one that failed always says so. */
const WORKED_NOTE_MIN_MS = 60_000;

/** Whether a blank row separates an entry from the one drawn before it. */
export function gapBefore(previous: MiniEntry | null, entry: MiniEntry): boolean {
  if (previous === null) return false;

  return !(previous.kind === "tool" && entry.kind === "tool");
}

export function noteEntry(
  key: string,
  text: string,
  role: "dim" | "error" | "warning" = "dim",
): MiniEntry {
  return { key, kind: "note", chunks: [{ text, role }] };
}

/**
 * `ready` is what can be committed to scrollback. `held` starts at the first entry that has not
 * settled: an answer there streams into scrollback; a tool there is what the run is doing now.
 */
export interface MiniPlan {
  readonly ready: readonly MiniEntry[];
  readonly held: readonly MiniEntry[];
  readonly path: readonly string[];
  readonly status: TurnStatus | null;
}

/** A tool heading without the status mark that every heading starts with. */
export function withoutMark(heading: readonly HeadingChunk[]): readonly HeadingChunk[] {
  return heading
    .slice(1)
    .map((chunk, index) => (index === 0 ? { ...chunk, text: chunk.text.trimStart() } : chunk));
}

/**
 * A finished tool's heading without its check mark, in the tool's own quiet color: only what
 * did not simply succeed is marked.
 */
function quietHeading(heading: readonly HeadingChunk[]): readonly HeadingChunk[] {
  if (heading[0]?.role !== "ok") return heading;

  return withoutMark(heading).map((chunk) =>
    chunk.role === "foreground" ? { ...chunk, role: "tool" } : chunk,
  );
}

/**
 * A tool's heading is taken expanded, which leaves out the expand hint: once the line is
 * scrollback, the hint no longer refers to anything on screen.
 */
function messageEntry(message: Message, tasks: readonly Task[]): MiniEntry | null {
  if (message.kind === "user") {
    const text = userText(shownContent(message));

    const mark = showsReport(message) ? GLYPHS.report : GLYPHS.said;

    return text === "" ? null : { key: message.id, kind: "user", mark, text };
  }

  if (showsThinking(message)) return null;

  if (showsText(message))
    return message.state.markdown.trim() === ""
      ? null
      : { key: message.id, kind: "answer", markdown: message.state.markdown };

  if (showsTool(message)) {
    const heading = quietHeading(toolCard(message, tasks, true).heading);
    const output = toolStatus(message).tone === "failure" ? toolOutput(message.state) : "";
    const shown = heading.map((chunk) => chunk.text).join("");

    return {
      key: message.id,
      kind: "tool",
      chunks:
        output === "" || shown.includes(output)
          ? heading
          : [...heading, { text: `\n${output}`, role: "error" }],
    };
  }

  return noteEntry(message.id, `${message.partKind}\n${readRawPart(message).body}`);
}

export function projectMiniTranscript(model: TranscriptModel, tasks: readonly Task[]): MiniPlan {
  const ready: MiniEntry[] = [];
  const held: MiniEntry[] = [];
  const path: string[] = [];
  let holding = false;
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
      holding = true;

    (holding ? held : ready).push(entry);
  };

  for (const row of model.rows) {
    switch (row.kind) {
      case "prompt":
        append(row.message);
        break;
      case "shell": {
        const running = row.job.state.kind === "running";

        if (running) holding = true;
        const heading = quietHeading(shellCard(row.job, row.job.startedAt, true).heading);
        const failed = heading.some((chunk) => chunk.role === "error");
        (holding ? held : ready).push({
          key: `shell:${row.job.id}`,
          kind: "tool",
          chunks: failed ? [...heading, { text: `\n${row.job.output}`, role: "error" }] : heading,
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

        if (notice === null && (current.durationMs ?? 0) < WORKED_NOTE_MIN_MS) break;
        (holding ? held : ready).push(
          noteEntry(
            `turn:${row.turn.info.id}`,
            notice === null
              ? `${ACTIVITY_WORKED_LABEL}${current.durationMs === null ? "" : ` for ${formatDuration(current.durationMs)}`}`
              : `${notice.text}${recovery === undefined ? "" : ` ${RECOVERY_STEPS[recovery]}`}`,
            notice === null ? "dim" : notice.tone === "danger" ? "error" : "warning",
          ),
        );
        break;
      }

      default: {
        const exhaustive: never = row;

        return exhaustive;
      }
    }
  }

  return { ready, held, path, status };
}
