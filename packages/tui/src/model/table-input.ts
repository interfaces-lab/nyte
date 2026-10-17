import type { RunId } from "@nyte-ai/sdk";
import { availableModels, findModel } from "../lib/catalog.ts";
import { runnableCommand, slashNamespace } from "./commands.ts";
import { completionModel } from "./completion.ts";
import type { CompletionModel } from "./completion.ts";
import type { Dialog } from "./dialogs/dialog.ts";
import { draftModel } from "./draft.ts";
import type { DraftModel } from "./draft.ts";
import { queueRows } from "./queue.ts";
import type { QueueRow } from "./queue.ts";
import { currentQuestion } from "./question.ts";
import type { QuestionModel } from "./question.ts";
import { followedSession } from "./state.ts";
import type { Draft, FollowedSession, ShellJob, State, Submission } from "./state.ts";

/** What the interaction table decides each command from. */
export interface TableInput {
  readonly run: RunModel;
  readonly question: QuestionModel | null;
  readonly draft: DraftModel;
  readonly runsCommand: boolean;
  readonly editing: EditingModel | null;
  readonly shell: ShellJob | null;
  readonly completion: CompletionModel | null;
  readonly dialog: Dialog | null;
  readonly blocked: Blocked | null;
  /** A blank chat's first message waits for the host to open. */
  readonly waiting: boolean;
  /** The host's model catalog has arrived, so model and thinking choices can be offered. */
  readonly models: boolean;
  readonly queue: readonly QueueRow[];
  readonly followUp: "steer" | "queue";
  readonly tasks: number;
  readonly now: number;
  readonly cursor: {
    readonly row: Draft["row"];
    readonly atStart: boolean;
    readonly atEnd: boolean;
  };
  readonly browsing: boolean;
}

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
  readonly stillPending: boolean;
}

export type Blocked =
  | { readonly kind: "no-session" }
  | { readonly kind: "switching" }
  | { readonly kind: "changing-directory" }
  | { readonly kind: "authenticating"; readonly link: string | null }
  | { readonly kind: "editor" };

export function runModel(view: FollowedSession | null): RunModel {
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

export function blockedBy(state: State): Blocked | null {
  const { pending } = state.local;

  if (pending.some((op) => op.kind === "switch")) return { kind: "switching" };

  const { chat } = state.facts;

  if (chat === null || (chat.kind === "session" && chat.view === null))
    return { kind: "no-session" };

  if (pending.some((op) => op.kind === "cd")) return { kind: "changing-directory" };
  const auth = pending.find((op) => op.kind === "auth");

  if (auth?.kind === "auth") return { kind: "authenticating", link: auth.link };

  if (pending.some((op) => op.kind === "editor")) return { kind: "editor" };

  return null;
}

/** How a message sent while a run works is delivered: the follow-up setting, or `queue` when the chat's model cannot take a message mid-turn. */
export function followUpDelivery(state: State): "steer" | "queue" {
  const { chat } = state.facts;
  const { catalog } = state.facts.catalog;
  const model =
    chat === null || catalog === null
      ? undefined
      : findModel(availableModels(catalog), chat.selection.model);

  return model?.capabilities.steer === false ? "queue" : state.facts.settings.followUp;
}

export function tableInputFor(state: State, dialog: Dialog | null): TableInput {
  const session = followedSession(state);

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
    waiting: waitingMessage(state) !== null,
    models: state.facts.catalog.catalog !== null,
    queue,
    followUp: followUpDelivery(state),
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

/** The first message of the blank chat on screen while it waits for the host to open, or `null`. */
export function waitingMessage(state: State): Submission | null {
  const { chat } = state.facts;

  if (chat?.kind !== "blank" || state.facts.host === "open") return null;

  return state.local.submissions.find((sent) => sent.session === chat.id) ?? null;
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

function runningShell(state: State): ShellJob | null {
  return state.facts.shells.find((job) => job.state.kind === "running") ?? null;
}
