import type { Execution, JobView, SessionId, SessionInfo, SessionView } from "@nyte-ai/sdk";
import {
  jobTaskState,
  sessionMark,
  showsText,
  showsTool,
  taskEnded,
  taskLabel,
  toolStatus,
} from "@nyte-ai/plugin/client/presentation";
import type { ReportMessage, TaskState, ToolTone } from "@nyte-ai/plugin/client/presentation";
import { GLYPHS } from "./constants.ts";
import { toolLine, userText } from "./format.ts";
import type { Timing } from "./format.ts";

export type Task =
  | {
      readonly kind: "agent";
      readonly id: SessionId;
      readonly info: SessionInfo;
      readonly view: SessionView | undefined;
    }
  | { readonly kind: "job"; readonly id: string; readonly job: JobView };

interface StatusMark {
  readonly glyph: string;
  readonly tone: "dim" | "running" | "warning" | "ok" | "error";
}

export function statusMark(state: TaskState): StatusMark {
  switch (state) {
    case "working":
      return { glyph: GLYPHS.bullet, tone: "running" };
    case "background":
      return { glyph: GLYPHS.background, tone: "running" };
    case "waiting":
    case "retrying":
      return { glyph: GLYPHS.bullet, tone: "warning" };
    case "done":
      return { glyph: GLYPHS.check, tone: "ok" };
    case "failed":
      return { glyph: GLYPHS.cross, tone: "error" };
    default: {
      const _exhaustive: never = state;

      return _exhaustive;
    }
  }
}

/** A tool line's mark: a stopped or interrupted call is dimmed, not done. */
export function toneMark(tone: ToolTone): StatusMark {
  switch (tone) {
    case "running":
      return statusMark("working");
    case "attention":
      return statusMark("waiting");
    case "success":
      return statusMark("done");
    case "failure":
      return statusMark("failed");
    case "stopped":
      return { glyph: GLYPHS.cross, tone: "dim" };
    default: {
      const _exhaustive: never = tone;

      return _exhaustive;
    }
  }
}

function agentExecution(task: Extract<Task, { kind: "agent" }>): Execution | undefined {
  return task.view?.execution ?? task.info.heads.find((head) => head.name === "main")?.execution;
}

/** A child reads as its chat's row does in every client; its open view's heads win over the listed ones as a unit. */
export function taskStatus(task: Task): TaskState {
  return task.kind === "agent" ? sessionMark(task.view ?? task.info) : jobTaskState(task.job.state);
}

export function canStopTask(task: Task): boolean {
  if (task.kind === "job") return task.job.state.kind === "running";
  const execution = agentExecution(task);

  if (execution === undefined || execution.kind === "idle") return false;

  return execution.kind !== "live" || !execution.stopping;
}

interface ReportRow {
  readonly mark: StatusMark;
  readonly title: string;
  readonly task: Task | undefined;
}

export function reportRow(report: ReportMessage, tasks: readonly Task[]): ReportRow {
  const { source } = report;

  if (source.kind === "job") {
    const task = tasks.find((candidate) => candidate.id === source.job);

    return {
      mark: statusMark(task === undefined ? "done" : taskStatus(task)),
      title: userText(report.content).split("\n")[0] ?? "",
      task,
    };
  }

  const task = tasks.find((candidate) => candidate.id === source.session);
  const state = source.end === "failed" ? "failed" : "done";

  return {
    mark: statusMark(state),
    title: `${taskLabel(state)} ${task === undefined ? "subagent" : taskTitle(task)}`,
    task,
  };
}

export function taskAgent(task: Task): string {
  return task.kind === "agent" ? "subagent" : "command";
}

export function taskTitle(task: Task): string {
  if (task.kind === "job") return task.job.title === "" ? task.job.command : task.job.title;

  return task.info.name ?? (task.view === undefined ? undefined : taskPrompt(task.view)) ?? task.id;
}

export function taskConfiguration(task: Extract<Task, { kind: "agent" }>): string {
  const effective = task.view?.configuration.effective;

  return effective === null || effective === undefined
    ? ""
    : `${effective.model.id} · ${effective.thinking}`;
}

function taskPrompt(view: SessionView): string | undefined {
  const user = view.messages.find((message) => message.kind === "user");

  return user?.kind === "user" ? oneLine(userText(user.content)) : undefined;
}

function oneLine(text: string): string {
  return text.trim().replace(/\s+/gu, " ");
}

export function taskActivity(task: Task): string {
  if (task.kind === "job") return oneLine(task.job.tail.trimEnd().split("\n").at(-1) ?? "");
  const execution = agentExecution(task);

  if (execution?.kind === "retrying") return execution.reason;

  if (execution?.kind === "idle" && execution.lastRun?.end.kind === "failed")
    return execution.lastRun.end.failure.message;

  return task.view === undefined ? "" : (taskSteps(task.view).at(-1)?.text ?? "");
}

interface TaskStep {
  readonly text: string;
}

function taskSteps(view: SessionView): TaskStep[] {
  const steps: TaskStep[] = [];

  for (const message of view.messages) {
    if (message.kind !== "part") continue;

    if (showsTool(message)) {
      const status = toolStatus(message);
      const progress = message.state.phase === "running" ? message.state.progress?.text : undefined;
      const title = toolLine(message.state.class, status.tense);

      steps.push({
        text: oneLine(
          progress !== undefined && progress !== ""
            ? progress
            : status.word === undefined
              ? title
              : `${title} · ${status.word.toLowerCase()}`,
        ),
      });
    } else if (showsText(message) && message.state.markdown !== "") {
      steps.push({ text: oneLine(message.state.markdown) });
    }
  }

  return steps;
}

export function taskTiming(task: Task): Timing | null {
  if (task.kind === "job") return { startedAt: task.job.startedAt, endedAt: task.job.endedAt };
  const execution = agentExecution(task);

  if (execution !== undefined && execution.kind !== "idle")
    return { startedAt: execution.run.startedAt, endedAt: null };
  const last = task.view?.turns.at(-1);

  return last === undefined || last.endedAt === null
    ? null
    : { startedAt: last.startedAt, endedAt: last.endedAt };
}

export function unfinishedTask(task: Task): boolean {
  return !taskEnded(taskStatus(task));
}
