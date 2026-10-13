/**
 * `deriveScreen` is the one place the TUI decides what anything means:
 * busy, the open question, what blocks the composer, the queue rows, the
 * placeholder, the hints, the footer, which dialog has the keyboard. Every
 * component reads a field of the result; no component recomputes one.
 *
 * Pure. `previous` lets sub-results keep identity when nothing changed, so
 * Solid's `<For>` and memos downstream stop at unchanged rows.
 */
import type { RunId } from "@nyte-ai/sdk";
import {
  ANSWER_COMPOSER_PLACEHOLDER,
  BUSY_COMPOSER_PLACEHOLDER,
  COMPOSER_PLACEHOLDER,
} from "../lib/constants.ts";
import { statusOf } from "../lib/program-status.ts";
import type { ProgramStatus } from "../lib/program-status.ts";
import { unfinishedTask } from "../lib/tasks.ts";
import type { Task } from "../lib/tasks.ts";
import { liveDialog } from "./choices.ts";
import { runnableCommand, slashNamespace } from "./commands.ts";
import { completionModel } from "./completion.ts";
import type { CompletionModel } from "./completion.ts";
import type { Dialog } from "./dialogs/dialog.ts";
import { draftModel, liveMarkers } from "./draft.ts";
import type { DraftModel, DraftPart, MarkerSpan } from "./draft.ts";
import { footerFor, hintsFor, sameHint } from "./footer.ts";
import type { FooterModel, Hint } from "./footer.ts";
import { keepEqual } from "./identity.ts";
import { blockedReason, interactionsFor } from "./interactions.ts";
import type { Interactions, TableInput } from "./interactions.ts";
import { queuedCount, queueRows, reportRows, sameQueueRow, sameReportRow } from "./queue.ts";
import type { QueueRow, ReportRow } from "./queue.ts";
import { currentQuestion, questionPanel, questionTitle } from "./question.ts";
import type { QuestionModel } from "./question.ts";
import { followedShells } from "./state.ts";
import type { FailureReport, Notice, ShellJob, State } from "./state.ts";
import { deriveTranscript } from "./transcript.ts";
import type { TranscriptModel } from "./transcript.ts";

export interface ScreenModel {
  readonly loading: string | null;
  /** Non-null while the followed session's watch has failed or ended; the failure line offers `retry-watch`. */
  readonly watch: WatchModel | null;
  readonly run: RunModel;
  readonly question: QuestionModel | null;
  readonly draft: DraftModel;
  /** The draft's live attachment markers, which the composer highlights. */
  readonly markers: readonly MarkerSpan[];
  /** The attachment preview open under the composer; it closes when its marker leaves the draft. */
  readonly preview: PreviewModel | null;
  readonly editing: EditingModel | null;
  readonly shell: ShellJob | null;
  readonly completion: CompletionModel | null;
  /** The dialog that owns the keyboard: the top of the stack, else the question panel when it is showing. */
  readonly dialog: Dialog | null;
  readonly blocked: Blocked | null;
  readonly queue: readonly QueueRow[];
  readonly reports: readonly ReportRow[];
  readonly transcript: TranscriptModel;
  /** The followed session's tasks: the inspector, delegation cards and report titles read them. */
  readonly tasks: readonly Task[];
  /** Wheel scrolling accelerates with speed (the `scrollAcceleration` setting). */
  readonly scrollAcceleration: boolean;
  readonly interactions: Interactions;
  readonly hints: readonly Hint[];
  readonly placeholder: string;
  readonly footer: FooterModel;
  readonly tasksLine: TasksLine | null;
  readonly notice: Notice | null;
  readonly failure: FailureReport | null;
  readonly program: ProgramStatus;
  readonly welcome: boolean;
  readonly followUp: "steer" | "queue";
  readonly selectionActive: boolean;
}

export interface PreviewModel {
  readonly marker: string;
  readonly part: DraftPart;
}

export interface WatchModel {
  /** The error the watch threw, or null when it ended on its own. */
  readonly failure: string | null;
}

/** `view.execution` read once. `busy` is `kind !== "idle"`; nothing else defines it. */
export type RunModel =
  | { readonly kind: "idle" }
  | { readonly kind: "working"; readonly run: RunId; readonly stopping: boolean }
  | { readonly kind: "waiting"; readonly run: RunId }
  | {
      readonly kind: "retrying";
      readonly run: RunId;
      readonly until: number;
      readonly reason: string;
    };

export interface EditingModel {
  readonly message: string;
  readonly delivery: "steer" | "queue";
  /** False once the message left the queue; `reduce` cancels the edit on the same view. */
  readonly stillPending: boolean;
}

/** Why the composer refuses input now. Ordered: the first that applies wins. */
export type Blocked =
  | { readonly kind: "starting" }
  | { readonly kind: "no-session" }
  | { readonly kind: "switching" }
  | { readonly kind: "changing-directory" }
  | { readonly kind: "authenticating"; readonly link: string | null }
  | { readonly kind: "editor" };

export interface TasksLine {
  readonly text: string;
  readonly attention: boolean;
}

const LOADING_STEPS = {
  workspace: "Opening workspace…",
  settings: "Loading settings…",
  providers: "Loading providers…",
} as const;

export function runModel(view: State["facts"]["session"]): RunModel {
  const execution = view?.view?.execution;

  if (execution === undefined) return { kind: "idle" };

  switch (execution.kind) {
    case "idle":
      return { kind: "idle" };
    case "live":
      return { kind: "working", run: execution.run.id, stopping: execution.stopping };
    case "waiting":
      return { kind: "waiting", run: execution.run.id };
    case "retrying":
      return {
        kind: "retrying",
        run: execution.run.id,
        until: execution.until,
        reason: execution.reason,
      };
    default: {
      const _exhaustive: never = execution;

      return _exhaustive;
    }
  }
}

/**
 * The single ordered rule; replaces `composerBlocked` and the separate
 * `submitComposer` guards. A switch outranks "no session", so the reason
 * names the switch while the new session's first view loads.
 */
export function blockedBy(state: State): Blocked | null {
  const { pending } = state.local;

  if (state.facts.phase.kind === "starting") return { kind: "starting" };

  if (pending.some((op) => op.kind === "switch")) return { kind: "switching" };

  if (state.facts.session === null || state.facts.session.view === null)
    return { kind: "no-session" };

  if (pending.some((op) => op.kind === "cd")) return { kind: "changing-directory" };
  const auth = pending.find((op) => op.kind === "auth");

  if (auth?.kind === "auth") return { kind: "authenticating", link: auth.link };

  if (pending.some((op) => op.kind === "editor")) return { kind: "editor" };

  return null;
}

/**
 * One placeholder per situation, from the same inputs as the table:
 * question panel showing → "" (the panel takes the answer);
 * question → "Type an answer, or press Enter to pick one" (names the subagent for a child's),
 * editing → "Edit the queued message",
 * shell running → "Esc stops the command",
 * blocked → its reason,
 * busy → followUp steer ? "Steer the run" : "Queue a follow-up",
 * else "Plan, search, build anything".
 */
export function placeholderFor(
  screen: Pick<ScreenModel, "question" | "editing" | "shell" | "run" | "blocked" | "followUp">,
): string {
  const { question } = screen;

  if (question !== null) {
    if (question.panel) return "";

    return question.owner.kind === "head"
      ? ANSWER_COMPOSER_PLACEHOLDER
      : `Answer subagent ${question.owner.short}, or press Enter to pick one`;
  }

  if (screen.editing !== null) return "Edit the queued message";

  if (screen.shell !== null) return "Esc stops the command";

  if (screen.blocked !== null) return blockedReason(screen.blocked);

  if (screen.run.kind !== "idle")
    return screen.followUp === "steer" ? BUSY_COMPOSER_PLACEHOLDER : "Queue a follow-up";

  return COMPOSER_PLACEHOLDER;
}

function loadingLine(state: State): string | null {
  const { phase, session } = state.facts;

  if (phase.kind === "starting") return LOADING_STEPS[phase.step];

  if (state.local.pending.some((op) => op.kind === "switch")) return "Loading session…";

  return session !== null && session.view === null ? "Loading session…" : null;
}

function tasksLine(state: State, question: QuestionModel | null): TasksLine | null {
  const active = state.facts.tasks.filter(unfinishedTask).length;

  if (active === 0) return null;

  if (question?.owner.kind === "child")
    return { text: "a background task needs your answer", attention: true };

  return { text: `${String(active)} running in background`, attention: false };
}

/** The table's inputs for a state, with `dialog` as the one that owns the keyboard (or none). */
export function tableInputFor(state: State, dialog: Dialog | null): TableInput {
  const { session } = state.facts;

  const question = currentQuestion(
    session === null ? null : { id: session.id, view: session.view },
    state.facts.tasks,
    state.local.question,
  );

  const queue = queueRows(session, state.local.editing);
  const { draft } = state.local;
  const typed = draftModel(draft);

  return {
    run: runModel(session),
    question,
    draft: typed,
    runsCommand:
      typed.kind === "message" &&
      typed.command !== null &&
      runnableCommand(state, draft.text) !== null,
    editing: editingModel(state, queue),
    shell: runningShell(state),
    completion:
      dialog === null
        ? completionModel(state.local.completion, draft, {
            commands: slashNamespace(state),
            files: state.facts.workspace.mentions,
          })
        : null,
    dialog,
    blocked: blockedBy(state),
    queue,
    followUp: state.facts.settings.followUp,
    tasks: state.facts.tasks.length,
    now: 0,
    cursor: {
      row: draft.row,
      atStart: draft.cursor === 0,
      atEnd: draft.cursor >= draft.text.length,
    },
    browsing: state.local.history !== null,
  };
}

/** The dialog with the keyboard: the stack's top with its live choices, else the question panel. */
export function keyboardDialog(state: State): Dialog | null {
  const top = state.local.dialogs.at(-1);

  if (top !== undefined) return liveDialog(state, top);
  const { session } = state.facts;

  return questionPanel(
    currentQuestion(
      session === null ? null : { id: session.id, view: session.view },
      state.facts.tasks,
      state.local.question,
    ),
    state.local.question,
  );
}

function editingModel(state: State, queue: readonly QueueRow[]): EditingModel | null {
  const { editing } = state.local;

  if (editing === null) return null;

  return {
    message: editing.message,
    delivery: editing.delivery,
    stillPending: queue.some((row) => row.id === editing.message),
  };
}

function sameSpan(left: MarkerSpan, right: MarkerSpan): boolean {
  return left.marker === right.marker && left.from === right.from && left.to === right.to;
}

function previewOf(
  state: State,
  markers: readonly MarkerSpan[],
  previous: PreviewModel | null,
): PreviewModel | null {
  const marker = state.local.preview;
  const part = marker === null ? undefined : state.local.draft.parts.get(marker);

  if (marker === null || part === undefined || !markers.some((span) => span.marker === marker))
    return null;

  return previous?.marker === marker && previous.part === part ? previous : { marker, part };
}

function runningShell(state: State): ShellJob | null {
  return state.facts.shells.find((job) => job.state.kind === "running") ?? null;
}

export function deriveScreen(state: State, previous: ScreenModel | null): ScreenModel {
  const session = state.facts.session;
  const view = session?.view ?? null;
  const dialog = keyboardDialog(state);
  const input = tableInputFor(state, dialog);
  const queue = keepEqual(previous?.queue, input.queue, sameQueueRow);

  const reports = keepEqual(
    previous?.reports,
    reportRows(session, state.facts.tasks),
    sameReportRow,
  );

  const interactions = interactionsFor(input);

  const hints =
    state.facts.terminal.dragging && previous !== null
      ? previous.hints
      : keepEqual(previous?.hints, hintsFor(interactions, state.facts.terminal.width), sameHint);

  const { question } = input;
  const execution = view?.execution;
  const markers = keepEqual(previous?.markers, liveMarkers(state.local.draft), sameSpan);

  return {
    loading: loadingLine(state),
    watch: session?.watch.kind === "failed" ? { failure: session.watch.failure } : null,
    run: input.run,
    question,
    draft: input.draft,
    markers,
    preview: previewOf(state, markers, previous?.preview ?? null),
    editing: input.editing,
    shell: input.shell,
    completion: input.completion,
    dialog,
    blocked: input.blocked,
    queue,
    reports,
    transcript: deriveTranscript(
      view,
      followedShells(state),
      state.local.transcript,
      previous?.transcript ?? null,
    ),
    tasks: state.facts.tasks,
    scrollAcceleration: state.facts.settings.scrollAcceleration,
    interactions,
    hints,
    placeholder: placeholderFor({ ...input, followUp: input.followUp }),
    footer: footerFor(state, input.run.kind === "idle" ? 0 : queuedCount(queue)),
    tasksLine: tasksLine(state, question),
    notice: state.local.notice,
    failure: state.local.failures.at(-1) ?? null,
    program: statusOf(
      {
        busy: input.run.kind !== "idle",
        execution,
        question: question === null ? undefined : questionTitle(question),
      },
      state.local.watchedRun ?? undefined,
    ),
    welcome: view !== null && view.turns.length === 0 && followedShells(state).length === 0,
    followUp: input.followUp,
    selectionActive: state.facts.terminal.selection,
  };
}
