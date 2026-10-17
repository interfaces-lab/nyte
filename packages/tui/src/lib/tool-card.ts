import { pathToFiletype } from "@opentui/core";
import { isJsonObject } from "@nyte-ai/schema";
import type { ToolClass } from "@nyte-ai/sdk";
import {
  delegateSubject,
  formatDuration,
  toolNoun,
  toolOutput,
  toolStatus,
  toolVerbs,
} from "@nyte-ai/plugin/client/presentation";
import type { ToolMessage, ToolStatus } from "@nyte-ai/plugin/client/presentation";
import type { ShellJob } from "../model/state.ts";
import {
  keycap,
  RESULT_PREVIEW_LINES,
  RESULT_TAIL_LINES,
  RESULT_TAIL_ONLY_LINES,
  TOOL_INLINE_PREVIEW_LENGTH,
} from "./constants.ts";
import {
  earlierLinesLabel,
  lowerFirst,
  omittedLabel,
  previewLines,
  resultSummary,
  toolLine,
} from "./format.ts";
import type { PreviewCut } from "./format.ts";
import { diffFromOutput, patchDiff, textPatch } from "./output-diff.ts";
import type { OutputDiff } from "./output-diff.ts";
import {
  statusMark,
  taskActivity,
  taskConfiguration,
  taskLabel,
  taskStatus,
  toneStatus,
} from "./tasks.ts";
import type { Task, TaskStatus } from "./tasks.ts";
import { displayWidth } from "./width.ts";

export type Role =
  | "muted"
  | "running"
  | "warning"
  | "ok"
  | "error"
  | "user"
  | "foreground"
  | "dim"
  | "tool";

export interface HeadingChunk {
  readonly text: string;
  readonly role: Role;
  readonly code?: "bash";
}

export type CardBody =
  | { readonly kind: "none" }
  | {
      readonly kind: "text";
      readonly text: string;
      readonly role: "dim" | "error";
      readonly filetype: string | undefined;
    }
  | {
      readonly kind: "diff";
      readonly before: string | undefined;
      readonly diff: OutputDiff;
      readonly after: string | undefined;
    }
  | { readonly kind: "activity"; readonly text: string };

export interface ToolCardModel {
  readonly heading: readonly HeadingChunk[];
  readonly body: CardBody;
}

type DelegationClass = Extract<ToolClass, { readonly kind: "delegate" }>;

const NONE: CardBody = { kind: "none" };

function previewCut(toolClass: ToolClass | undefined): PreviewCut {
  return toolClass?.kind === "shell"
    ? { kind: "tail", max: RESULT_TAIL_ONLY_LINES }
    : { kind: "head-tail", head: RESULT_PREVIEW_LINES, tail: RESULT_TAIL_LINES };
}

function inlineToolPreview(text: string): string | undefined {
  const value = text.trim();

  if (value === "" || value.includes("\n") || displayWidth(value) > TOOL_INLINE_PREVIEW_LENGTH)
    return undefined;

  return value;
}

export function toolOutputPreview(text: string, expanded: boolean, cut: PreviewCut): string {
  const trimmed = text.replace(/\n+$/u, "");

  if (expanded || trimmed === "") return trimmed;
  const preview = previewLines(trimmed, cut);

  if (preview.omitted === 0) return preview.text;

  const omission =
    cut.kind === "tail" ? earlierLinesLabel(preview.omitted) : omittedLabel(preview.omitted);

  return preview.text.replace(omission, `${omission} · ${keycap("chat.tools.toggle")} expand`);
}

function tail(parts: readonly (string | undefined)[]): readonly HeadingChunk[] {
  const text = parts.filter((part) => part !== undefined && part !== "").join(" · ");

  return text === "" ? [] : [{ text: `  ${text}`, role: "dim" }];
}

function titleChunks(title: string, command: string | undefined): readonly HeadingChunk[] {
  if (command === undefined || command === "" || !title.endsWith(command))
    return [{ text: ` ${title}`, role: "foreground" }];

  return [
    { text: ` ${title.slice(0, title.length - command.length)}`, role: "foreground" },
    { text: command, role: "foreground", code: "bash" },
  ];
}

function heading(
  glyph: string,
  role: Role,
  title: string,
  parts: readonly (string | undefined)[],
  command?: string,
): readonly HeadingChunk[] {
  return [{ text: glyph, role }, ...titleChunks(title, command), ...tail(parts)];
}

function shellCommand(toolClass: ToolClass): string | undefined {
  return toolClass.kind === "shell" ? toolClass.command : undefined;
}

function textBody(
  text: string,
  expanded: boolean,
  cut: PreviewCut,
  role: "dim" | "error",
  filetype: string | undefined,
): CardBody {
  const preview = toolOutputPreview(text, expanded, cut);

  return preview === "" ? NONE : { kind: "text", text: preview, role, filetype };
}

function diffBody(diff: OutputDiff, expanded: boolean, cut: PreviewCut): CardBody {
  const panel = (text: string | undefined): string | undefined => {
    if (text === undefined) return undefined;
    const preview = toolOutputPreview(text, expanded, cut);

    return preview === "" ? undefined : preview;
  };

  return { kind: "diff", before: panel(diff.before), diff, after: panel(diff.after) };
}

function partClock(message: ToolMessage): string | undefined {
  const { status } = message;

  return message.state.class.kind === "shell" && status.kind === "settled"
    ? formatDuration(status.endedAt - message.at)
    : undefined;
}

function settled(
  message: ToolMessage,
  status: ToolStatus,
  expanded: boolean,
  isError: boolean,
): ToolCardModel {
  const toolClass = message.state.class;
  const output = message.state.phase === "settled" ? toolOutput(message.state) : "";
  const outputDiff = isError ? undefined : diffFromOutput(output);
  const state = message.state.phase === "settled" ? message.state : undefined;
  const patch = state?.outcome.kind === "ok" ? textPatch(state.outcome.output) : undefined;
  const word = status.word?.toLowerCase();
  const clock = partClock(message);
  const cut = previewCut(toolClass);
  const title = toolLine(toolClass, status.tense);
  const command = shellCommand(toolClass);
  const check = statusMark("done");

  if (toolClass.kind === "edit" && patch !== undefined)
    return {
      heading: heading(
        check.glyph,
        check.tone,
        title,
        [`+${String(patch.added)} -${String(patch.removed)}`, word, clock],
        command,
      ),
      body: diffBody(patchDiff(patch), expanded, cut),
    };

  const changes = state?.changes ?? null;

  if (toolClass.kind === "edit" && !isError && changes !== null)
    return {
      heading: heading(
        check.glyph,
        check.tone,
        title,
        [`+${String(changes.added)} -${String(changes.removed)}`, word, clock],
        command,
      ),
      body:
        outputDiff === undefined
          ? textBody(output, expanded, cut, "dim", undefined)
          : diffBody(outputDiff, expanded, cut),
    };

  if (outputDiff !== undefined) {
    const hunks = outputDiff.files.reduce((count, file) => count + file.sections.length, 0);

    return {
      heading: heading(
        check.glyph,
        check.tone,
        title,
        [`${String(hunks)} ${hunks === 1 ? "hunk" : "hunks"}`, word, clock],
        command,
      ),
      body: diffBody(outputDiff, expanded, cut),
    };
  }

  const inline = inlineToolPreview(output);
  const summary = inline ?? resultSummary(output);
  const collapsedRead = toolClass.kind === "read" && !isError && !expanded && inline === undefined;

  const result = collapsedRead
    ? [summary, `${keycap("chat.tools.toggle")} expand`]
        .filter((value) => value !== undefined)
        .join(" · ")
    : summary;

  const mark = statusMark(isError ? "failed" : "done");

  if (collapsedRead || inline !== undefined)
    return {
      heading: heading(mark.glyph, mark.tone, title, [result, word, clock], command),
      body: NONE,
    };

  const filetype =
    status.tense !== "running" && toolClass.kind === "read"
      ? pathToFiletype(toolClass.path)
      : undefined;

  return {
    heading: heading(mark.glyph, mark.tone, title, [result, word, clock], command),
    body: textBody(output, expanded, cut, isError ? "error" : "dim", filetype),
  };
}

function findChildTask(message: ToolMessage, tasks: readonly Task[]): Task | undefined {
  const toolClass = message.state.class;

  if (toolClass.kind !== "delegate") return undefined;

  return tasks.find(
    (candidate) =>
      candidate.kind === "agent" &&
      (toolClass.child === null
        ? candidate.info.call === message.state.call
        : candidate.id === toolClass.child),
  );
}

export function agentStatus(message: ToolMessage, tasks: readonly Task[]): TaskStatus {
  const task = findChildTask(message, tasks);

  return task === undefined ? toneStatus(toolStatus(message).tone) : taskStatus(task);
}

function delegation(
  message: ToolMessage,
  toolClass: DelegationClass,
  status: ToolStatus,
  tasks: readonly Task[],
): ToolCardModel {
  const task = findChildTask(message, tasks);
  const word = status.word?.toLowerCase();

  if (toolClass.role !== "create" && toolClass.role !== "task") {
    const own = statusMark(toneStatus(status.tone));
    const name = task === undefined ? delegateSubject(toolClass) : taskLabel(task);

    const verb =
      status.tense === "none" ? undefined : lowerFirst(toolVerbs(toolClass)[status.tense]);

    return {
      heading: [
        { text: `${own.glyph} `, role: own.tone },
        ...(verb === undefined ? [] : [{ text: `${verb} `, role: "foreground" } as const]),
        { text: name, role: "tool" },
        ...(verb === undefined
          ? [{ text: ` ${toolNoun(toolClass) ?? ""}`, role: "foreground" } as const]
          : []),
        ...(word === undefined ? [] : [{ text: `  ${word}`, role: "dim" } as const]),
      ],
      body: NONE,
    };
  }

  const mark = statusMark(agentStatus(message, tasks));
  const { args } = message.state;
  const worktree = isJsonObject(args) && args.isolation === "worktree" ? "worktree" : "";

  const config = [task?.kind === "agent" ? taskConfiguration(task) : "", worktree]
    .filter((detail) => detail !== "")
    .join(" · ");

  const rest = task === undefined ? word : config === "" ? undefined : config;
  const activity = task === undefined ? "" : taskActivity(task);

  return {
    heading: [
      { text: `${mark.glyph} `, role: mark.tone },
      {
        text: task === undefined ? delegateSubject(toolClass) : taskLabel(task),
        role: "foreground",
      },
      ...(rest === undefined ? [] : [{ text: `  ${rest}`, role: "dim" } as const]),
    ],
    body: activity === "" ? NONE : { kind: "activity", text: activity },
  };
}

export function toolCard(
  message: ToolMessage,
  tasks: readonly Task[],
  expanded: boolean,
): ToolCardModel {
  const status = toolStatus(message);
  const toolClass = message.state.class;

  if (toolClass.kind === "delegate") return delegation(message, toolClass, status, tasks);

  switch (status.tone) {
    case "running":
    case "attention":
    case "stopped": {
      const text =
        message.state.phase === "settled"
          ? toolOutput(message.state)
          : message.state.phase === "running"
            ? (message.state.progress?.text ?? "")
            : "";

      const inline = inlineToolPreview(text);
      const mark = statusMark(toneStatus(status.tone));

      return {
        heading: heading(
          mark.glyph,
          status.tone === "running" && text !== "" ? "user" : mark.tone,
          toolLine(toolClass, status.tense),
          [inline ?? resultSummary(text), status.word?.toLowerCase(), partClock(message)],
          shellCommand(toolClass),
        ),
        body:
          inline !== undefined || text === ""
            ? NONE
            : textBody(text, expanded, previewCut(toolClass), "dim", undefined),
      };
    }

    case "failure":
      return settled(message, status, expanded, true);
    case "success":
      return settled(message, status, expanded, false);
    default: {
      const _exhaustive: never = status.tone;

      return _exhaustive;
    }
  }
}

function shellOutcome(job: ShellJob): string | undefined {
  const { state } = job;

  switch (state.kind) {
    case "running":
      return undefined;
    case "exited":
      return state.code === 0 ? undefined : `exit ${String(state.code)}`;
    case "signalled":
      return state.signal;
    case "cancelled":
      return "cancelled";
    case "failed":
      return state.message;
    default: {
      const _exhaustive: never = state;

      return _exhaustive;
    }
  }
}

export function shellCard(job: ShellJob, now: number, expanded: boolean): ToolCardModel {
  const outcome = shellOutcome(job);
  const running = job.state.kind === "running";
  const mark = statusMark(running ? "running" : outcome === undefined ? "done" : "failed");

  return {
    heading: heading(
      mark.glyph,
      mark.tone,
      `${job.include ? "!" : "!!"} ${job.command}`,
      [
        resultSummary(job.output),
        outcome,
        running ? formatDuration(now - job.startedAt) : undefined,
        job.include ? undefined : "not sent to model",
      ],
      job.command,
    ),
    body: textBody(
      job.output,
      expanded,
      { kind: "tail", max: RESULT_TAIL_ONLY_LINES },
      outcome === undefined ? "dim" : "error",
      undefined,
    ),
  };
}
