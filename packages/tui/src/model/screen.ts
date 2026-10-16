import {
  ANSWER_COMPOSER_PLACEHOLDER,
  BUSY_COMPOSER_PLACEHOLDER,
  COMPOSER_PLACEHOLDER,
} from "../lib/constants.ts";
import { statusOf } from "../lib/program-status.ts";
import type { ProgramStatus } from "../lib/program-status.ts";
import { unfinishedTask } from "../lib/tasks.ts";
import type { Task } from "../lib/tasks.ts";
import { landingMessages } from "../lib/view-helpers.ts";
import { liveDialog } from "./choices.ts";
import type { CompletionModel } from "./completion.ts";
import type { Dialog } from "./dialogs/dialog.ts";
import { liveMarkers } from "./draft.ts";
import type { DraftModel, DraftPart, MarkerSpan } from "./draft.ts";
import { footerFor, hintsFor, sameHint } from "./footer.ts";
import type { FooterModel, Hint } from "./footer.ts";
import { keepEqual } from "./identity.ts";
import { blockedReason, interactionsFor } from "./interactions.ts";
import type { Interactions } from "./interactions.ts";
import { queuedCount, sameQueueRow } from "./queue.ts";
import type { QueueRow } from "./queue.ts";
import { currentQuestion, questionPanel, questionTitle } from "./question.ts";
import type { QuestionModel } from "./question.ts";
import { followedShells } from "./state.ts";
import type { FailureReport, Notice, ShellJob, State } from "./state.ts";
import { tableInputFor } from "./table-input.ts";
import type { Blocked, EditingModel, RunModel } from "./table-input.ts";
import { deriveTranscript } from "./transcript.ts";
import type { TranscriptModel } from "./transcript.ts";

export interface ScreenModel {
  readonly opening: boolean;
  readonly watch: WatchModel | null;
  readonly run: RunModel;
  readonly question: QuestionModel | null;
  readonly draft: DraftModel;
  readonly markers: readonly MarkerSpan[];
  readonly preview: PreviewModel | null;
  readonly editing: EditingModel | null;
  readonly shell: ShellJob | null;
  readonly completion: CompletionModel | null;
  readonly dialog: Dialog | null;
  readonly blocked: Blocked | null;
  readonly queue: readonly QueueRow[];
  readonly transcript: TranscriptModel;
  readonly tasks: readonly Task[];
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
  readonly failure: string | null;
}

export interface TasksLine {
  readonly text: string;
  readonly attention: boolean;
}

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

function tasksLine(state: State, question: QuestionModel | null): TasksLine | null {
  const active = state.facts.tasks.filter(unfinishedTask).length;

  if (active === 0) return null;

  if (question?.owner.kind === "child")
    return { text: "a background task needs your answer", attention: true };

  return { text: `${String(active)} running in background`, attention: false };
}

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

function sameSpan(left: MarkerSpan, right: MarkerSpan): boolean {
  return left.marker === right.marker && left.from === right.from && left.to === right.to;
}

function livePreview(
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

export function deriveScreen(state: State, previous: ScreenModel | null): ScreenModel {
  const session = state.facts.session;
  const view = session?.view ?? null;
  const dialog = keyboardDialog(state);
  const input = tableInputFor(state, dialog);
  const queue = keepEqual(previous?.queue, input.queue, sameQueueRow);

  const interactions = interactionsFor(input);

  const hints =
    state.facts.terminal.dragging && previous !== null
      ? previous.hints
      : keepEqual(previous?.hints, hintsFor(interactions, state.facts.terminal.width), sameHint);

  const { question } = input;
  const execution = view?.execution;
  const markers = keepEqual(previous?.markers, liveMarkers(state.local.draft), sameSpan);

  return {
    opening: view === null,
    watch: session?.watch.kind === "failed" ? { failure: session.watch.failure } : null,
    run: input.run,
    question,
    draft: input.draft,
    markers,
    preview: livePreview(state, markers, previous?.preview ?? null),
    editing: input.editing,
    shell: input.shell,
    completion: input.completion,
    dialog,
    blocked: input.blocked,
    queue,
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
    welcome:
      view !== null &&
      view.turns.length === 0 &&
      landingMessages(view).length === 0 &&
      followedShells(state).length === 0,
    followUp: input.followUp,
    selectionActive: state.facts.terminal.selection,
  };
}
