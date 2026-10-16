import type { Execution, JobView, RunEnd, SessionId, SessionInfo, SessionView } from "@nyte-ai/sdk";
import { GLYPHS } from "./constants.ts";
import { userText } from "./format.ts";
import type { Timing } from "./format.ts";
import { toolTitle } from "./tool-copy.ts";
import { isTextMessage, isToolMessage, toolStatus } from "./view-helpers.ts";
import type { ReportMessage, ToolTone } from "./view-helpers.ts";

export type Task =
  | {
      readonly kind: "agent";
      readonly id: SessionId;
      readonly info: SessionInfo;
      readonly view: SessionView | undefined;
    }
  | { readonly kind: "job"; readonly id: string; readonly job: JobView };

export type TaskStatus =
  | "queued"
  | "running"
  | "waiting"
  | "retrying"
  | "stopping"
  | "stopped"
  | "done"
  | "failed";

interface StatusMark {
  readonly glyph: string;
  readonly tone: "muted" | "running" | "warning" | "ok" | "error";
}

export function statusMark(status: TaskStatus): StatusMark {
  switch (status) {
    case "queued":
      return { glyph: GLYPHS.diamond, tone: "muted" };
    case "running":
      return { glyph: GLYPHS.bullet, tone: "running" };
    case "waiting":
    case "retrying":
      return { glyph: GLYPHS.bullet, tone: "warning" };
    case "stopping":
      return { glyph: GLYPHS.bullet, tone: "muted" };
    case "stopped":
      return { glyph: GLYPHS.cross, tone: "muted" };
    case "done":
      return { glyph: GLYPHS.check, tone: "ok" };
    case "failed":
      return { glyph: GLYPHS.cross, tone: "error" };
    default: {
      const _exhaustive: never = status;

      return _exhaustive;
    }
  }
}

function agentExecution(task: Extract<Task, { kind: "agent" }>): Execution | undefined {
  return task.view?.execution ?? task.info.heads.find((head) => head.name === "main")?.execution;
}

export function taskStatus(task: Task): TaskStatus {
  if (task.kind === "agent") return executionStatus(agentExecution(task));
  const { state } = task.job;

  switch (state.kind) {
    case "running":
      return "running";
    case "exited":
      return state.reason === "exited" ? (state.code === 0 ? "done" : "failed") : "stopped";
    case "lost":
      return "stopped";
    default: {
      const _exhaustive: never = state;

      return _exhaustive;
    }
  }
}

export function toneStatus(tone: ToolTone): TaskStatus {
  switch (tone) {
    case "running":
      return "running";
    case "attention":
      return "waiting";
    case "success":
      return "done";
    case "failure":
      return "failed";
    case "stopped":
      return "stopped";
    default: {
      const _exhaustive: never = tone;

      return _exhaustive;
    }
  }
}

function executionStatus(execution: Execution | undefined): TaskStatus {
  if (execution === undefined) return "queued";

  switch (execution.kind) {
    case "idle": {
      const end = execution.lastRun?.end;

      return end === undefined ? "queued" : endStatus(end.kind);
    }

    case "live":
      return execution.stopping ? "stopping" : "running";
    case "waiting":
      return "waiting";
    case "retrying":
      return "retrying";
    default: {
      const _exhaustive: never = execution;

      return _exhaustive;
    }
  }
}

function endStatus(end: RunEnd["kind"]): TaskStatus {
  switch (end) {
    case "completed":
      return "done";
    case "stopped":
      return "stopped";
    case "failed":
      return "failed";
    default: {
      const _exhaustive: never = end;

      return _exhaustive;
    }
  }
}

export function canStopTask(task: Task): boolean {
  if (task.kind === "job") return task.job.state.kind === "running";
  const execution = agentExecution(task);

  if (execution === undefined || execution.kind === "idle") return false;

  return execution.kind !== "live" || !execution.stopping;
}

export interface ReportRow {
  readonly mark: StatusMark;
  readonly title: string;
  readonly task: Task | undefined;
}

const REPORT_VERBS = {
  completed: "Finished",
  failed: "Failed",
  stopped: "Stopped",
} satisfies Record<RunEnd["kind"], string>;

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

  return {
    mark: statusMark(endStatus(source.end)),
    title: `${REPORT_VERBS[source.end]} ${task === undefined ? "subagent" : taskLabel(task)}`,
    task,
  };
}

export function reportHeld(execution: Execution): boolean {
  return execution.kind === "idle" && execution.lastRun?.end.kind !== "completed";
}

export function taskAgent(task: Task): string {
  return task.kind === "agent" ? "subagent" : "command";
}

export function taskLabel(task: Task): string {
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
  readonly status: TaskStatus;
  readonly text: string;
}

function taskSteps(view: SessionView): TaskStep[] {
  const steps: TaskStep[] = [];

  for (const message of view.messages) {
    if (message.kind !== "part") continue;

    if (isToolMessage(message)) {
      const status = toolStatus(message.state, message.status);
      const progress = message.state.phase === "running" ? message.state.progress?.text : undefined;
      const title = toolTitle(message.state.class, status.tense);

      steps.push({
        status: toneStatus(status.tone),
        text: oneLine(
          progress !== undefined && progress !== ""
            ? progress
            : status.word === undefined
              ? title
              : `${title} · ${status.word.toLowerCase()}`,
        ),
      });
    } else if (isTextMessage(message) && message.state.markdown !== "") {
      steps.push({
        status: message.status.kind === "settled" ? "done" : "running",
        text: oneLine(message.state.markdown),
      });
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
  return !["done", "failed", "stopped"].includes(taskStatus(task));
}
