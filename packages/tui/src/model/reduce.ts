/**
 * The only writer of `State`. Pure: (state, msg, now) → new state plus the
 * effects to run. A thrown error here is a bug; the store reports it and
 * keeps the previous state.
 *
 * Domains own their messages; the root switch only routes. The switch is
 * exhaustive over `Msg["kind"]`, so a new message without a handler fails
 * the build.
 */
import type { Delivery, MessageId, MoveOptions } from "@nyte-ai/sdk";
import { availableModels, clampThinking, findModel, modelId } from "../lib/catalog.ts";
import { shortId } from "../lib/format.ts";
import { canStopTask } from "../lib/tasks.ts";
import { hasInlineSkills, parseComposerSubmission } from "../lib/slash.ts";
import {
  initialHighlight,
  listTitle,
  liveChoices,
  resumeChoices,
  shortcutLines,
} from "./choices.ts";
import { resolveCommand, slashNamespace } from "./commands.ts";
import {
  completionEdit,
  completionModel,
  dismissCompletion,
  inlineTokenRange,
  moveCompletion,
  nextCompletion,
  splice,
} from "./completion.ts";
import type { CompletionModel } from "./completion.ts";
import type { Dialog, DialogInput, DialogRequest } from "./dialogs/dialog.ts";
import { dialogCommandOf, reduceDialog } from "./dialogs/dialog.ts";
import { withPrompt } from "./dialogs/auth.ts";
import type { AuthDialog } from "./dialogs/auth.ts";
import { typedLabel } from "./dialogs/list.ts";
import type { ListDialog, ListPurpose } from "./dialogs/list.ts";
import { modelList, withModels } from "./dialogs/model-picker.ts";
import type { ModelDialog } from "./dialogs/model-picker.ts";
import { withTree } from "./dialogs/tree.ts";
import {
  addPart,
  draftFromContent,
  draftModel,
  liveMarkers,
  markerAt,
  PASTE_COLLAPSE_LINES,
  sameSnapshot,
  snapshot,
} from "./draft.ts";
import type { Effect } from "./effect.ts";
import { promptEntries } from "./history.ts";
import { chatCommands, interactionsFor } from "./interactions.ts";
import type { Intent, Msg, Outcome } from "./msg.ts";
import { queueRows, rowMessage } from "./queue.ts";
import { keyboardDialog, runModel, tableInputFor } from "./screen.ts";
import { facts, listDirectories, stageHandback } from "./session.ts";
import { settingRows, applyChoice } from "./settings.ts";
import type { PendingOp, Selection, State } from "./state.ts";
import {
  andThen,
  clearDraft,
  insertText,
  mint,
  moveCursor,
  replaceRange,
  setDraft,
  stay,
  withFacts,
  withLocal,
  withNotice,
} from "./step.ts";
import { deriveTranscript, rowWeight } from "./transcript.ts";
import { revealEarlier } from "./window.ts";

export interface Step {
  readonly state: State;
  readonly effects: readonly Effect[];
}

/** Double-press window for Esc → tree. */
const ESCAPE_WINDOW_MS = 500;

export function reduce(state: State, msg: Msg, now: number): Step {
  switch (msg.kind) {
    case "send":
    case "save-edit":
    case "cancel-edit":
    case "clear-draft":
    case "run-shell":
    case "stop-shell":
    case "history":
    case "paste":
    case "focus-composer":
    case "open-editor":
    case "open-attachment":
    case "close-preview":
    case "completion":
    case "prefill":
      return composer(state, msg, now);
    case "edit-queued":
    case "promote":
    case "withdraw":
    case "reorder":
      return queue(state, msg, now);
    case "stop-run":
    case "answer":
    case "open-question":
    case "escape-tree":
    case "move-to":
    case "stop-task":
    case "step-task":
      return run(state, msg, now);
    case "switch-session":
    case "retry-watch":
    case "change-directory":
    case "reload":
    case "compact":
    case "update":
    case "configure":
    case "write-settings":
    case "apply-setting":
    case "cycle-thinking":
    case "cycle-model":
    case "quit":
    case "plugin-command":
    case "cancel-auth":
    case "auth-answer":
      return session(state, msg, now);
    case "scroll":
    case "reveal-earlier":
    case "toggle-tool-output":
    case "toggle-disclosure":
    case "copy-selection":
    case "copy-text":
    case "open-external":
      return transcript(state, msg, now);
    case "open":
    case "dialog":
    case "choose":
    case "run-command":
    case "refuse":
    case "dismiss-notice":
    case "noop":
      return dialogs(state, msg, now);
    case "phase":
    case "session-opened":
    case "view":
    case "watch-ended":
    case "session-info":
    case "selection":
    case "catalog":
    case "settings":
    case "tasks":
    case "workspace":
    case "shell-job":
    case "terminal":
    case "draft-changed":
    case "scrolled":
    case "failure":
    case "tick":
      return facts(state, msg, now);
    case "sent":
    case "send-refused":
    case "revised":
    case "withdrawn":
    case "answered":
    case "moved":
    case "run-stopped":
    case "loaded":
    case "load-failed":
    case "paste-resolved":
    case "editor-closed":
    case "op-finished":
    case "effect-failed":
    case "inform":
    case "directory-listed":
    case "preview-loaded":
      return outcomes(state, msg, now);
    default: {
      const _exhaustive: never = msg;

      return _exhaustive;
    }
  }
}

/** Reduces several intents in order, as one step. */
function all(state: State, intents: readonly Intent[], now: number): Step {
  return intents.reduce<Step>(
    (step, intent) => andThen(step, (current) => reduce(current, intent, now)),
    stay(state),
  );
}

function refuse(
  state: State,
  reason: string,
  now: number,
  tone: "info" | "warning" | "error" = "warning",
): Step {
  return stay(withNotice(state, reason, tone, now));
}

function busy(state: State): boolean {
  return runModel(state.facts.session).kind !== "idle";
}

function completionNow(state: State): CompletionModel | null {
  return completionModel(state.local.completion, state.local.draft, {
    commands: slashNamespace(state),
    files: state.facts.workspace.mentions,
  });
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

/**
 * `send` with the composer's current draft. A known `/command` clears the
 * draft and runs; anything else is a prompt: a submission snapshots the
 * draft, the composer clears at once, and the runner prepares parts, runs
 * plugin `beforeSubmit`, reserves a configurator slot and sends. A refusal
 * comes back as `send-refused` with the snapshot, which lands in the
 * composer again.
 */
export function composer(
  state: State,
  msg: Extract<
    Intent,
    {
      readonly kind:
        | "send"
        | "save-edit"
        | "cancel-edit"
        | "clear-draft"
        | "run-shell"
        | "stop-shell"
        | "history"
        | "paste"
        | "focus-composer"
        | "open-editor"
        | "open-attachment"
        | "close-preview"
        | "completion"
        | "prefill";
    }
  >,
  now: number,
): Step {
  switch (msg.kind) {
    case "send":
      return send(state, msg.delivery, msg.warning ?? null, now);
    case "save-edit":
      return saveEdit(state, msg.delivery, now);
    case "cancel-edit": {
      const { editing } = state.local;

      return editing === null
        ? stay(state)
        : setDraft(withLocal(state, { editing: null }), editing.saved);
    }

    case "clear-draft":
      return clearDraft(state);
    case "run-shell": {
      if (state.facts.shells.some((job) => job.state.kind === "running"))
        return refuse(state, "A command is already running", now);
      const minted = mint(state, "shell");

      return andThen(clearDraft(minted.state), (current) => ({
        state: following(current),
        effects: [
          {
            kind: "shell-start",
            id: minted.id,
            command: msg.command,
            include: msg.include,
            cwd: current.facts.workspace.cwd,
          },
          { kind: "scroll", op: { kind: "latest" } },
        ],
      }));
    }

    case "stop-shell": {
      const running = state.facts.shells.find((job) => job.state.kind === "running");

      return running === undefined
        ? stay(state)
        : { state, effects: [{ kind: "shell-stop", id: running.id }] };
    }

    case "history":
      return history(state, msg.direction);
    case "paste": {
      const generation = state.local.pasteGeneration;
      // A paste is input like a key: it takes the notice back.
      const next = withLocal(state, { history: null, notice: null });

      if (msg.source.kind === "clipboard")
        return { state: next, effects: [{ kind: "read-clipboard", generation }] };

      return {
        state: next,
        effects: [
          {
            kind: "resolve-paste",
            generation,
            text: msg.source.text,
            bytes: msg.source.bytes,
            cwd: state.facts.workspace.cwd,
          },
        ],
      };
    }

    case "open-editor":
      if (state.local.pending.some((op) => op.kind === "editor")) return stay(state);

      return {
        state: withLocal(state, { pending: [...state.local.pending, { kind: "editor" }] }),
        effects: [
          {
            kind: "open-editor",
            text: state.local.draft.text,
            command: state.facts.settings.externalEditor ?? null,
          },
        ],
      };
    case "open-attachment": {
      const span = markerAt(state.local.draft);
      const part = span === null ? undefined : state.local.draft.parts.get(span.marker);

      if (span === null || part === undefined) return stay(state);

      if (part.kind === "paste") return replaceRange(state, span.from, span.to, part.text);

      if (state.local.preview === span.marker) return stay(withLocal(state, { preview: null }));
      const next = withLocal(state, { preview: span.marker });

      return part.kind === "file" && !part.directory && part.body === undefined
        ? { state: next, effects: [{ kind: "read-preview", marker: span.marker, path: part.path }] }
        : stay(next);
    }

    case "close-preview":
      return stay(withLocal(state, { preview: null }));
    case "focus-composer":
      return { state, effects: [{ kind: "composer", op: { kind: "focus" } }] };

    case "completion":
      return completion(state, msg.action, now);
    case "prefill":
      return insertText(state, msg.text, "start");
    default: {
      const _exhaustive: never = msg;

      return _exhaustive;
    }
  }
}

function send(state: State, delivery: Delivery, warning: string | null, now: number): Step {
  const followed = state.facts.session;

  if (followed === null) return refuse(state, "Wait for the followed to open", now);
  const draft = draftModel(state.local.draft);

  if (draft.kind !== "message") return stay(state);

  if (draft.command !== null) {
    const entry = resolveCommand(state, draft.command);
    const parsed = parseComposerSubmission(draft.text);

    // A skill named inside the draft makes the whole draft a prompt; `/cd` still runs.
    const skills = new Map(
      (followed.view?.catalog.skills ?? []).map((skill) => [skill.name, skill]),
    );
    const prompting = entry?.name !== "cd" && hasInlineSkills(draft.text, skills);

    if (entry !== null && !entry.prompt && parsed.kind === "command" && !prompting) {
      const argument = parsed.command.argument;

      return andThen(clearDraft(state), (current) =>
        reduce(current, entry.run(argument) ?? { kind: "prefill", text: `/${entry.name} ` }, now),
      );
    }
  }

  const minted = mint(state, "submission");

  const submission = {
    id: minted.id,
    session: followed.id,
    snapshot: snapshot(state.local.draft),
    replace: null,
  };

  const queued = withLocal(minted.state, {
    submissions: [...minted.state.local.submissions, submission],
  });

  const noticed = warning === null ? queued : withNotice(queued, warning, "warning", now);

  return andThen(clearDraft(noticed), (current) => ({
    state: following(current),
    effects: [
      { kind: "send", submission, delivery },
      { kind: "scroll", op: { kind: "latest" } },
    ],
  }));
}

/** Back at the transcript's tail, following new output: what Ctrl+End and every send do. */
function following(state: State): State {
  return withLocal(state, {
    transcript: { ...state.local.transcript, following: true, window: { kind: "tail" } },
  });
}

function saveEdit(state: State, delivery: Delivery, now: number): Step {
  const { editing } = state.local;
  const followed = state.facts.session;

  if (editing === null || followed === null) return stay(state);
  const message = rowMessage(followed, editing.message);

  if (message === null || message.status.kind === "landed")
    return refuse(withLocal(state, { editing: null }), "Already sent", now);
  const edited = snapshot(state.local.draft);
  const restore = setDraft(withLocal(state, { editing: null }), editing.saved);

  if (delivery === editing.delivery && sameSnapshot(edited, draftFromContent(message.content)))
    return restore;
  const minted = mint(restore.state, "submission");

  const submission = {
    id: minted.id,
    session: followed.id,
    snapshot: edited,
    replace: editing.message,
  };

  return {
    state: withLocal(minted.state, {
      submissions: [...minted.state.local.submissions, submission],
    }),
    effects: [...restore.effects, { kind: "send", submission, delivery }],
  };
}

function history(state: State, direction: "previous" | "next"): Step {
  const { draft } = state.local;
  const entries = promptEntries(state.facts.session?.view ?? null);
  const cursor = state.local.history;

  if (direction === "previous") {
    if (draft.cursor !== 0) return moveCursor(state, "start");

    if (entries.length === 0) return stay(state);
    const index = cursor === null ? entries.length - 1 : cursor.index - 1;
    const entry = entries[index];

    if (entry === undefined) return stay(state);

    const browsing = withLocal(state, {
      history: { index, saved: cursor?.saved ?? snapshot(draft) },
    });

    return andThen(setDraft(browsing, entry), (current) => moveCursor(current, "start"));
  }

  if (draft.cursor < draft.text.length) return moveCursor(state, "end");

  if (cursor === null) return stay(state);
  const entry = entries[cursor.index + 1];

  if (entry === undefined) return setDraft(withLocal(state, { history: null }), cursor.saved);

  return setDraft(withLocal(state, { history: { ...cursor, index: cursor.index + 1 } }), entry);
}

function completion(
  state: State,
  action: Extract<Intent, { kind: "completion" }>["action"],
  now: number,
): Step {
  const model = completionNow(state);

  if (model === null) return stay(state);

  switch (action.kind) {
    case "close":
      return stay(withLocal(state, { completion: dismissCompletion(state.local.completion) }));
    case "move":
      return stay(
        withLocal(state, { completion: moveCompletion(state.local.completion, model, action.by) }),
      );
    case "pick":
      return acceptCompletion(state, model, action.index, "return", null, now);
    case "fill":
      return acceptCompletion(state, model, model.highlighted, "tab", null, now);
    case "accept":
      return acceptCompletion(state, model, model.highlighted, "return", action.alternate, now);
    default: {
      const _exhaustive: never = action;

      return _exhaustive;
    }
  }
}

/** Re-derives the completion after an edit the reducer made, asking for a `/cd` listing when needed. */
function recomplete(current: State): Step {
  return listDirectories(
    current.local.completion,
    withLocal(current, {
      completion: nextCompletion(current.local.completion, current.local.draft),
    }),
  );
}

function acceptCompletion(
  state: State,
  model: CompletionModel,
  index: number,
  via: "return" | "tab",
  alternate: Delivery | null,
  now: number,
): Step {
  const item = model.items[index];

  if (item === undefined) return stay(state);

  const edit = completionEdit(
    model,
    item,
    state.local.draft,
    alternate === null ? via : "tab",
    { commands: slashNamespace(state), files: state.facts.workspace.mentions },
    state.facts.workspace.cwd,
  );

  if (edit === null) return stay(state);

  switch (edit.kind) {
    case "replace": {
      const spliced = splice(state.local.draft.text, edit.from, edit.to, edit.text);

      const replaced = andThen(
        replaceRange(state, edit.from, edit.to, spliced.inserted),
        recomplete,
      );

      return alternate === null
        ? replaced
        : andThen(replaced, (current) => send(current, alternate, null, now));
    }

    case "file": {
      const added = addPart(state.local.draft.parts, {
        kind: "file",
        path: edit.path,
        directory: edit.directory,
      });

      const spliced = splice(state.local.draft.text, edit.from, edit.to, `${added.marker} `);
      const withPart = withLocal(state, { draft: { ...state.local.draft, parts: added.parts } });

      return andThen(replaceRange(withPart, edit.from, edit.to, spliced.inserted), recomplete);
    }

    case "execute": {
      const entry = resolveCommand(state, edit.name);
      const intent: Intent = entry?.run("") ?? { kind: "prefill", text: `/${edit.name} ` };
      const range = inlineTokenRange(state.local.draft.text, edit.from, edit.to);

      const cleared = edit.leading
        ? clearDraft(state)
        : andThen(replaceRange(state, range.from, range.to, ""), recomplete);

      return andThen(cleared, (current) => reduce(current, intent, now));
    }

    default: {
      const _exhaustive: never = edit;

      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

/**
 * Queue operations. Each re-checks the row against the current view here and
 * the runner re-checks again before the SDK call, so an operation aimed at a
 * row that just landed never becomes an edit that stops the run.
 *
 * withdraw(id):  row pending? effect withdraw(session, id) : notice
 * promote(id):   row pending && not joined? effect revise(id, content, delivery steer, position null)
 * reorder(id,to): earlier → before the previous pending row (one inbox order, any delivery);
 *                 later → before the row after next, or last; effect revise(id, content, row.delivery, position)
 * edit-queued(id): row editable? local.editing = { id, delivery, saved: snapshot(draft) };
 *                 composer set(draftFromContent(message.content))
 */
export function queue(
  state: State,
  msg: Extract<Intent, { readonly kind: "edit-queued" | "promote" | "withdraw" | "reorder" }>,
  now: number,
): Step {
  const followed = state.facts.session;

  if (followed === null) return stay(state);
  const rows = queueRows(followed, state.local.editing);
  const row = rows.find((candidate) => candidate.id === msg.message);
  const message = rowMessage(followed, msg.message);

  if (row === undefined || message === null) return refuse(state, "Already sent", now);

  switch (msg.kind) {
    case "edit-queued": {
      if (state.local.editing !== null)
        return refuse(state, "Save or cancel the current queue edit first.", now);

      if (!row.editable)
        return refuse(state, `"${row.text}" is an action; it can't be edited.`, now);

      const editing = {
        message: row.id,
        delivery: row.delivery === "queue" ? ("queue" as const) : ("steer" as const),
        saved: snapshot(state.local.draft),
      };

      const next = withNotice(
        withLocal(state, { editing }),
        "Editing queued message. Enter saves; Esc cancels.",
        "info",
        now,
      );

      return setDraft(next, draftFromContent(message.content));
    }

    case "promote":
      if (!row.withdrawable) return refuse(state, "That message is still sending", now, "info");

      if (row.place.kind === "joining")
        return refuse(state, "That message already joins this run", now, "info");

      return {
        state,
        effects: [
          {
            kind: "revise",
            session: followed.id,
            message: row.id,
            content: message.content,
            delivery: "steer",
            position: null,
          },
        ],
      };
    case "withdraw":
      if (!row.withdrawable)
        return refuse(
          state,
          "That message is still sending; it can't be removed yet.",
          now,
          "info",
        );

      return { state, effects: [{ kind: "withdraw", session: followed.id, message: row.id }] };
    case "reorder": {
      const pending = rows.filter((candidate) => candidate.withdrawable);
      const index = pending.findIndex((candidate) => candidate.id === row.id);

      if (index === -1) return stay(state);

      const before = reorderTarget(
        pending.map((candidate) => candidate.id),
        index,
        msg.to,
      );

      if (before === undefined) return stay(state);

      return {
        state,
        effects: [
          {
            kind: "revise",
            session: followed.id,
            message: row.id,
            content: message.content,
            delivery: row.delivery,
            position: before === null ? { kind: "last" } : { kind: "before", message: before },
          },
        ],
      };
    }

    default: {
      const _exhaustive: never = msg;

      return _exhaustive;
    }
  }
}

/** The message to move before (null = last), or undefined when the move changes nothing. */
function reorderTarget(
  ids: readonly MessageId[],
  index: number,
  to: Extract<Intent, { kind: "reorder" }>["to"],
): MessageId | null | undefined {
  if (to === "earlier") return index <= 0 ? undefined : ids[index - 1];

  if (to === "later") return index >= ids.length - 1 ? undefined : (ids[index + 2] ?? null);

  if (to.before === null) return index >= ids.length - 1 ? undefined : null;

  if (to.before === ids[index] || to.before === ids[index + 1]) return undefined;

  return ids.includes(to.before) ? to.before : null;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

/**
 * stop-run:      run working|waiting|retrying → effect stop-run(run.id)
 * answer:        effect answer(session, part, choice, typed ? snapshot(draft) : null); typed → composer clear
 * open-question: local.question.dismissed = null
 * escape-tree:   a second Esc within 500 ms opens the tree (refused while busy), else arms
 * move-to:       effect move(commit, running refuse, abandoned, expect)
 * stop-task:     the task's own stop, refused when it already finished
 */
export function run(
  state: State,
  msg: Extract<
    Intent,
    {
      readonly kind:
        | "stop-run"
        | "answer"
        | "open-question"
        | "escape-tree"
        | "move-to"
        | "stop-task"
        | "step-task";
    }
  >,
  now: number,
): Step {
  const followed = state.facts.session;

  switch (msg.kind) {
    case "stop-run": {
      const current = runModel(followed);

      if (followed === null || current.kind === "idle")
        return refuse(state, "No active run to stop.", now, "info");

      return { state, effects: [{ kind: "stop-run", session: followed.id, run: current.run }] };
    }

    case "answer": {
      const dismissed = withLocal(state, {
        question: { ...state.local.question, dismissed: msg.part },
      });

      if (!msg.typed)
        return {
          state: dismissed,
          effects: [
            {
              kind: "answer",
              session: msg.session,
              part: msg.part,
              choice: msg.choice,
              typed: null,
            },
          ],
        };
      const typed = snapshot(state.local.draft);

      return andThen(clearDraft(dismissed), (current) => ({
        state: current,
        effects: [
          { kind: "answer", session: msg.session, part: msg.part, choice: msg.choice, typed },
        ],
      }));
    }

    case "open-question":
      return stay(
        withLocal(state, {
          question: { dismissed: null, highlighted: 0, query: "", answering: null },
        }),
      );
    case "escape-tree": {
      const armed = state.local.escapeArmedAt;

      if (armed === null || now - armed > ESCAPE_WINDOW_MS)
        return stay(withLocal(state, { escapeArmedAt: now }));

      return openDialog(
        withLocal(state, { escapeArmedAt: null }),
        { kind: "tree", filter: "default" },
        now,
      );
    }

    case "move-to": {
      if (followed === null) return stay(state);

      if (busy(state))
        return refuse(state, "Wait for the current run before changing the followed branch", now);

      const landed = followed.view?.messages.find(
        (message) =>
          message.kind === "user" &&
          message.status.kind === "landed" &&
          message.status.commit === msg.commit,
      );

      const options: MoveOptions = {
        running: "refuse",
        abandoned:
          msg.abandoned === "keep"
            ? "keep"
            : {
                summarize:
                  msg.abandoned.summarize.instructions === null
                    ? {}
                    : { instructions: msg.abandoned.summarize.instructions },
              },
        expect: msg.expect,
      };

      return {
        state: withLocal(state, { move: { purpose: "tree", message: landed?.id ?? null } }),
        effects: [
          {
            kind: "move",
            session: followed.id,
            position: { kind: "commit", id: msg.commit },
            options,
            handback: null,
          },
        ],
      };
    }

    case "stop-task": {
      const task = state.facts.tasks.find((candidate) => candidate.id === msg.task);

      if (followed === null || task === undefined)
        return refuse(state, "This task is no longer available.", now, "info");

      if (task.kind === "job" && task.job.state.kind !== "running")
        return refuse(
          state,
          "This task has already finished. /tasks opens its output.",
          now,
          "info",
        );

      if (!canStopTask(task)) return refuse(state, "This task has already finished.", now, "info");

      return {
        state: withNotice(state, "Cancellation requested.", "info", now),
        effects: [
          {
            kind: "stop-task",
            session: followed.id,
            task:
              task.kind === "agent"
                ? { kind: "agent", session: task.id }
                : { kind: "job", job: task.id },
          },
        ],
      };
    }

    case "step-task": {
      const stack = state.local.dialogs.map((dialog) => {
        if (dialog.kind !== "inspector" || dialog.id !== msg.dialog) return dialog;
        const tasks = state.facts.tasks;
        const index = tasks.findIndex((task) => task.id === dialog.task);
        const next = tasks[index + msg.direction];

        return next === undefined
          ? dialog
          : { ...dialog, task: next.id, following: true, scroll: null };
      });

      return stay(withLocal(state, { dialogs: stack }));
    }

    default: {
      const _exhaustive: never = msg;

      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

function nextThinkingLevel<Level extends string>(
  current: Level,
  supported: readonly Level[],
): Level | undefined {
  if (supported.length < 2) return undefined;

  return supported[(supported.indexOf(current) + 1) % supported.length];
}

/**
 * retry-watch: facts.session.watch failed → watch live; effect follow(session.id, announce false), which
 *   re-opens every watch of the followed session; ignored while live.
 * configure: the configurator's selection moves at once (the footer and the next Shift+Tab read it);
 *   the runner's `selection` fact confirms or corrects it.
 */
export function session(
  state: State,
  msg: Extract<
    Intent,
    {
      readonly kind:
        | "switch-session"
        | "retry-watch"
        | "change-directory"
        | "reload"
        | "compact"
        | "update"
        | "configure"
        | "write-settings"
        | "apply-setting"
        | "cycle-thinking"
        | "cycle-model"
        | "quit"
        | "plugin-command"
        | "cancel-auth"
        | "auth-answer";
    }
  >,
  now: number,
): Step {
  const followed = state.facts.session;
  const pending = state.local.pending;

  switch (msg.kind) {
    case "switch-session": {
      if (pending.some((op) => op.kind === "switch" || op.kind === "cd"))
        return refuse(state, "A chat switch is already in progress", now);

      if (followed !== null && msg.session === followed.id)
        return refuse(state, `Already in ${shortId(followed.id)}`, now, "info");
      const draft = snapshot(state.local.draft);

      const drafts =
        followed === null
          ? state.local.drafts
          : draft.text === ""
            ? Object.fromEntries(
                Object.entries(state.local.drafts).filter(([key]) => key !== followed.id),
              )
            : { ...state.local.drafts, [followed.id]: draft };

      const switching = withLocal(state, {
        drafts,
        pending: [...pending, { kind: "switch", session: msg.session, announce: msg.announce }],
        pasteGeneration: state.local.pasteGeneration + 1,
        editing: null,
        dialogs: [],
      });

      return andThen(clearDraft(switching), (current) => ({
        state: current,
        effects: [{ kind: "follow", target: msg.session, announce: msg.announce }],
      }));
    }

    case "retry-watch":
      if (followed === null || followed.watch.kind === "live") return stay(state);

      return {
        state: withFacts(state, { session: { ...followed, watch: { kind: "live" } } }),
        effects: [{ kind: "follow", target: followed.id, announce: false }],
      };
    case "change-directory":
      if (followed === null) return stay(state);

      if (busy(state))
        return refuse(state, "Wait for the current run before changing directories", now);

      if (queueRows(followed, null).length > 0)
        return refuse(state, "Send or remove the queued messages first", now);

      if (pending.some((op) => op.kind === "switch" || op.kind === "cd"))
        return refuse(state, "Wait for the workspace switch to finish.", now);

      return {
        state: withLocal(state, { pending: [...pending, { kind: "cd", path: msg.path }] }),
        effects: [{ kind: "change-directory", session: followed.id, path: msg.path }],
      };
    case "reload":
      if (pending.some((op) => op.kind === "reload")) return stay(state);

      return {
        state: withNotice(
          withLocal(state, { pending: [...pending, { kind: "reload" }] }),
          "Reloading…",
          "info",
          now,
        ),
        effects: [{ kind: "reload" }],
      };
    case "compact":
      if (followed === null) return stay(state);

      if (busy(state)) return refuse(state, "Wait for the current run before compacting", now);

      return {
        state,
        effects: [{ kind: "compact", session: followed.id, instructions: msg.instructions }],
      };
    case "update":
      return { state, effects: [{ kind: "self-update", version: msg.version }] };
    case "configure": {
      const step = configure(state, msg.selection, now);
      const level = msg.selection.effort;

      if (followed === null || level === undefined || msg.selection.model !== undefined)
        return step;
      const text =
        followed.selection.effort === level ? `Already using ${level}` : `Thinking level: ${level}`;

      return { ...step, state: withNotice(step.state, text, "info", now) };
    }

    case "write-settings": {
      const settings = withFacts(state, { settings: { ...state.facts.settings, ...msg.patch } });

      return {
        state:
          msg.patch.theme === undefined
            ? settings
            : withNotice(settings, `Theme: ${msg.patch.theme}`, "info", now),
        effects: [{ kind: "write-settings", patch: msg.patch }],
      };
    }
    case "apply-setting":
      if (followed === null) return stay(state);

      return {
        state,
        effects: [
          {
            kind: "apply-setting",
            session: followed.id,
            id: msg.id,
            scope: msg.scope,
            value: msg.value,
          },
        ],
      };
    case "cycle-thinking": {
      if (followed === null) return stay(state);

      const models =
        state.facts.catalog.catalog === null ? [] : availableModels(state.facts.catalog.catalog);

      const info = findModel(models, followed.selection.model);

      const next =
        info === undefined
          ? undefined
          : nextThinkingLevel(followed.selection.effort, info.thinking);

      return next === undefined ? stay(state) : configure(state, { effort: next }, now);
    }

    case "cycle-model": {
      if (followed === null) return stay(state);

      const models =
        state.facts.catalog.catalog === null ? [] : availableModels(state.facts.catalog.catalog);

      if (models.length < 2) return stay(state);

      const index = models.findIndex(
        (model) => modelId(model.ref) === modelId(followed.selection.model),
      );

      const model =
        models[index === -1 ? 0 : (index + msg.direction + models.length) % models.length];

      if (model === undefined) return stay(state);

      return configure(
        state,
        { model: model.ref, effort: clampThinking(model, followed.selection.effort), fast: false },
        now,
      );
    }

    case "quit":
      return { state, effects: [{ kind: "exit", code: 0 }] };
    case "plugin-command":
      if (followed === null) return stay(state);

      return {
        state,
        effects: [
          {
            kind: "run-command",
            session: followed.id,
            name: msg.name,
            argument: msg.argument === "" ? null : msg.argument,
          },
        ],
      };
    case "cancel-auth": {
      const auth = state.local.dialogs.find(
        (dialog): dialog is AuthDialog => dialog.kind === "auth",
      );

      const next = withNotice(
        withLocal(state, {
          pending: pending.filter((op) => op.kind !== "auth"),
          dialogs: state.local.dialogs.filter((dialog) => dialog.kind !== "auth"),
        }),
        "Authentication cancelled.",
        "info",
        now,
      );

      return auth === undefined
        ? stay(next)
        : { state: next, effects: [{ kind: "login-answer", dialog: auth.id, answer: null }] };
    }

    case "auth-answer":
      return { state, effects: [{ kind: "login-answer", dialog: msg.dialog, answer: msg.answer }] };
    default: {
      const _exhaustive: never = msg;

      return _exhaustive;
    }
  }
}

function configure(state: State, selection: Partial<Selection>, now: number): Step {
  const followed = state.facts.session;

  if (followed === null) return refuse(state, "Wait for the session to open", now);
  const merged = { ...followed.selection, ...selection };
  const next = withFacts(state, { session: { ...followed, selection: merged } });

  const told =
    selection.model === undefined
      ? next
      : withNotice(next, `Model: ${modelId(merged.model)} · ${merged.effort}`, "info", now);

  return { state: told, effects: [{ kind: "configure", session: followed.id, selection }] };
}

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------

export function transcript(
  state: State,
  msg: Extract<
    Intent,
    {
      readonly kind:
        | "scroll"
        | "reveal-earlier"
        | "toggle-tool-output"
        | "toggle-disclosure"
        | "copy-selection"
        | "copy-text"
        | "open-external";
    }
  >,
  now: number,
): Step {
  const local = state.local.transcript;

  switch (msg.kind) {
    case "scroll":
      switch (msg.to) {
        case "page-up":
          return { state, effects: [{ kind: "scroll", op: { kind: "page", direction: -1 } }] };
        case "page-down":
          return { state, effects: [{ kind: "scroll", op: { kind: "page", direction: 1 } }] };
        case "latest":
          return { state: following(state), effects: [{ kind: "scroll", op: { kind: "latest" } }] };
        case "previous-turn":
          return { state, effects: [{ kind: "scroll", op: { kind: "turn", direction: -1 } }] };
        case "next-turn":
          return { state, effects: [{ kind: "scroll", op: { kind: "turn", direction: 1 } }] };
        default: {
          const _exhaustive: never = msg.to;

          return _exhaustive;
        }
      }

    case "reveal-earlier": {
      const model = deriveTranscript(
        state.facts.session?.view ?? null,
        state.facts.shells,
        local,
        null,
      );

      if (model.window.start === 0) return stay(state);

      const window = revealEarlier(
        model.rows,
        (row) => rowWeight(row, model.turns, local),
        model.window,
      );

      return {
        state: withLocal(state, { transcript: { ...local, following: false, window } }),
        effects: [{ kind: "scroll", op: { kind: "keep-viewport" } }],
      };
    }

    case "toggle-tool-output": {
      const toolOutput = local.toolOutput === "expanded" ? "collapsed" : "expanded";

      return stay(
        withNotice(
          withLocal(state, { transcript: { ...local, toolOutput } }),
          `Output ${toolOutput}`,
          "info",
          now,
        ),
      );
    }

    case "toggle-disclosure": {
      const disclosures = new Set(local.disclosures);

      if (!disclosures.delete(msg.key)) disclosures.add(msg.key);

      return stay(withLocal(state, { transcript: { ...local, disclosures } }));
    }

    case "copy-selection":
      return stay(state);
    case "copy-text":
      return {
        state: withNotice(state, "Copied to clipboard", "info", now),
        effects: [{ kind: "copy", text: msg.text }],
      };
    case "open-external":
      return { state, effects: [{ kind: "open-external", target: msg.target }] };
    default: {
      const _exhaustive: never = msg;

      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

export function dialogs(
  state: State,
  msg: Extract<
    Intent,
    {
      readonly kind:
        | "open"
        | "dialog"
        | "choose"
        | "run-command"
        | "refuse"
        | "dismiss-notice"
        | "noop";
    }
  >,
  now: number,
): Step {
  switch (msg.kind) {
    case "open":
      return openDialog(state, msg.dialog, now);
    case "dialog":
      return dialogCommand(state, msg.command, now);
    case "choose":
      return choose(state, msg, now);
    case "run-command": {
      const entry = resolveCommand(state, msg.name);

      if (entry === null) return refuse(state, `Unknown command /${msg.name}`, now);

      return reduce(
        state,
        entry.run(msg.argument) ?? { kind: "prefill", text: `/${entry.name} ` },
        now,
      );
    }

    case "refuse":
      return refuse(state, msg.reason, now, msg.tone ?? "warning");
    case "dismiss-notice":
      return stay(
        withLocal(state, {
          notice: null,
          watchedRun: busy(state) ? state.local.watchedRun : null,
        }),
      );
    case "noop":
      return stay(state);
    default: {
      const _exhaustive: never = msg;

      return _exhaustive;
    }
  }
}

function push(state: State, dialog: Dialog, effects: readonly Effect[] = []): Step {
  return { state: withLocal(state, { dialogs: [...state.local.dialogs, dialog] }), effects };
}

function listDialog(state: State, id: string, purpose: ListPurpose): ListDialog {
  const items = liveChoices(state, purpose);

  return {
    kind: "list",
    id,
    purpose,
    title: listTitle(state, purpose),
    choices: items === null ? { kind: "loading" } : { kind: "ready", items },
    query: "",
    highlighted: items === null ? 0 : initialHighlight(state, purpose, items),
    answering: typedLabel(purpose) === null ? null : "",
    busy: false,
  };
}

function openDialog(state: State, request: DialogRequest, now: number): Step {
  const followed = state.facts.session;
  const minted = mint(state, "dialog");
  const { id } = minted;

  switch (request.kind) {
    case "list": {
      const { purpose } = request;

      if (purpose.kind === "question") return reduce(state, { kind: "open-question" }, now);

      if (purpose.kind === "skills" && liveChoices(state, purpose)?.length === 0)
        return refuse(state, "No skills found. Add SKILL.md to .nyte/skills.", now, "info");

      if (purpose.kind === "queue" && liveChoices(state, purpose)?.length === 0)
        return refuse(state, "Nothing is queued", now, "info");
      const dialog = listDialog(minted.state, id, purpose);

      return push(
        minted.state,
        dialog,
        purpose.kind === "resume"
          ? [{ kind: "load", dialog: id, request: { kind: "sessions" } }]
          : [],
      );
    }

    case "model": {
      if (followed === null) return refuse(state, "Wait for the session to open", now);
      const catalog = state.facts.catalog.catalog;

      const dialog: ModelDialog = {
        kind: "model",
        id,
        models: { kind: "loading" },
        query: "",
        highlighted: 0,
        field: "effort",
        drafts: new Map(),
        current: followed.selection.model,
        effort: followed.selection.effort,
      };

      return push(
        minted.state,
        catalog === null ? dialog : withModels(dialog, modelList(catalog)),
        [{ kind: "load", dialog: id, request: { kind: "models" } }],
      );
    }

    case "tree":
      if (followed === null) return refuse(state, "Wait for the session to open", now);

      if (busy(state))
        return refuse(state, "Wait for the current run before changing the session branch", now);

      return push(
        minted.state,
        {
          kind: "tree",
          id,
          tree: { kind: "loading" },
          filter: request.filter,
          query: "",
          folded: new Set(),
          selected: null,
          composerEmpty: state.local.draft.text.trim() === "",
        },
        [{ kind: "load", dialog: id, request: { kind: "tree", session: followed.id } }],
      );
    case "inspector":
      return push(minted.state, {
        kind: "inspector",
        id,
        task: request.task,
        following: true,
        scroll: null,
      });
    case "text": {
      const title = { usage: "Usage", shortcuts: "Keyboard shortcuts", plugins: "Plugins" }[
        request.content
      ];

      if (request.content === "shortcuts")
        return push(minted.state, {
          kind: "text",
          id,
          title,
          body: { kind: "ready", lines: shortcutLines(state) },
          scroll: 0,
        });

      if (request.content === "usage" && followed === null)
        return refuse(state, "Wait for the session to open", now);

      return push(minted.state, { kind: "text", id, title, body: { kind: "loading" }, scroll: 0 }, [
        {
          kind: "load",
          dialog: id,
          request:
            request.content === "usage" && followed !== null
              ? { kind: "usage", session: followed.id }
              : { kind: "plugins" },
        },
      ]);
    }

    case "auth": {
      if (state.local.pending.some((op) => op.kind === "auth"))
        return refuse(state, "An authentication command is already running.", now);

      if (request.provider === null)
        return openDialog(
          state,
          { kind: "list", purpose: { kind: "provider", mode: request.mode } },
          now,
        );
      const pending: PendingOp = { kind: "auth", provider: request.provider, link: null };

      const authenticating = withLocal(minted.state, {
        pending: [...minted.state.local.pending, pending],
      });

      if (request.mode === "logout")
        return { state: authenticating, effects: [{ kind: "logout", provider: request.provider }] };

      return push(
        authenticating,
        {
          kind: "auth",
          id,
          mode: request.mode,
          provider: request.provider,
          step: { kind: "starting" },
        },
        [{ kind: "login", provider: request.provider, dialog: id }],
      );
    }

    default: {
      const _exhaustive: never = request;

      return _exhaustive;
    }
  }
}

/** Forwards a key or typed text to the dialog that owns the keyboard, then reduces what it asked for. */
function dialogCommand(state: State, input: DialogInput, now: number): Step {
  const dialog = keyboardDialog(state);
  const command = dialog === null ? null : dialogCommandOf(dialog, input);

  if (dialog === null || command === null) return stay(state);
  const result = reduceDialog(dialog, command);
  const onStack = state.local.dialogs.at(-1)?.id === dialog.id;
  let next: State;

  if (onStack) {
    const below = state.local.dialogs.slice(0, -1);
    const kept = result.dialog === null ? below : [...below, result.dialog];

    next = withLocal(state, { dialogs: result.push === null ? kept : [...kept, result.push] });
  } else if (dialog.kind === "list" && dialog.purpose.kind === "question") {
    const { purpose } = dialog;
    const after = result.dialog;

    next = withLocal(state, {
      question:
        after === null || after.kind !== "list"
          ? { dismissed: purpose.part, highlighted: 0, query: "", answering: null }
          : {
              ...state.local.question,
              highlighted: after.highlighted,
              query: after.query,
              answering: after.answering,
            },
    });
  } else next = state;

  return all(next, result.intents, now);
}

function findDialog(state: State, id: string): Dialog | null {
  const stacked = state.local.dialogs.find((dialog) => dialog.id === id);

  if (stacked !== undefined) return stacked;
  const panel = keyboardDialog(state);

  return panel?.id === id ? panel : null;
}

function withoutDialog(state: State, id: string): State {
  return withLocal(state, { dialogs: state.local.dialogs.filter((dialog) => dialog.id !== id) });
}

/** What accepting a list row means, one entry per purpose. */
function choose(state: State, msg: Extract<Intent, { kind: "choose" }>, now: number): Step {
  const dialog = findDialog(state, msg.dialog);

  if (dialog === null || dialog.kind !== "list") return stay(state);
  const { purpose } = dialog;
  const closed = withoutDialog(state, dialog.id);
  const choice = msg.choice;

  switch (purpose.kind) {
    case "question":
      return reduce(
        state,
        {
          kind: "answer",
          session: purpose.session,
          part: purpose.part,
          choice: msg.typed ?? choice ?? "",
          typed: false,
        },
        now,
      );
    case "resume": {
      if (choice === null) return stay(state);

      if (choice === state.facts.session?.id)
        return refuse(closed, `Already in ${shortId(choice)}`, now, "info");
      const target = purpose.sessions.find((id) => id === choice);

      return target === undefined
        ? stay(closed)
        : reduce(closed, { kind: "switch-session", session: target, announce: true }, now);
    }

    case "palette": {
      if (choice === null || choice === "cmd:help") return stay(closed);

      if (choice === "shortcuts")
        return openDialog(closed, { kind: "text", content: "shortcuts" }, now);

      if (choice === "cmd:cd") return reduce(closed, { kind: "prefill", text: "/cd " }, now);

      if (choice.startsWith("cmd:"))
        return reduce(
          closed,
          { kind: "run-command", name: choice.slice("cmd:".length), argument: "" },
          now,
        );
      const command = chatCommands().find((name) => `action:${name}` === choice);

      const intent =
        command === undefined ? null : interactionsFor(tableInputFor(closed, null))[command].intent;

      return intent === null
        ? refuse(closed, "That shortcut is no longer available.", now)
        : reduce(closed, intent, now);
    }

    case "skills":
      return choice === null
        ? stay(closed)
        : reduce(closed, { kind: "prefill", text: `/${choice} ` }, now);
    case "queue": {
      if (choice === null) return stay(state);
      const rows = queueRows(state.facts.session, state.local.editing);
      const row = rows.find((candidate) => candidate.id === choice);

      if (row === undefined) return refuse(state, "Already sent", now);

      switch (msg.action) {
        case "chat.queue.edit":
          return reduce(closed, { kind: "edit-queued", message: row.id }, now);
        case "chat.queue.delete":
          return reduce(closed, { kind: "withdraw", message: row.id }, now);
        case "chat.queue.up":
          return reduce(state, { kind: "reorder", message: row.id, to: "earlier" }, now);
        case "chat.queue.down":
          return reduce(state, { kind: "reorder", message: row.id, to: "later" }, now);
        default:
          return reduce(closed, { kind: "promote", message: row.id }, now);
      }
    }

    case "settings": {
      const row = settingRows(state).find((candidate) => candidate.id === choice);

      if (row === undefined) return stay(state);

      if (busy(state) && !row.whileBusy)
        return refuse(state, `Wait for the current run before changing ${row.label}`, now);

      if (row.id === "model") return openDialog(state, { kind: "model" }, now);

      return openDialog(state, { kind: "list", purpose: { kind: "setting", key: row.id } }, now);
    }

    case "setting": {
      const row = settingRows(state).find((candidate) => candidate.id === purpose.key);
      const option = row?.choices.find((candidate) => candidate.id === choice);

      if (row === undefined || option === undefined) return stay(closed);

      return reduce(closed, applyChoice(state, row, option), now);
    }

    case "summary": {
      const tree = closed.local.dialogs.at(-1);
      const withoutTree = tree?.kind === "tree" ? withoutDialog(closed, tree.id) : closed;

      const abandoned =
        msg.typed !== null
          ? { summarize: { instructions: msg.typed } }
          : choice === "summarize"
            ? { summarize: { instructions: null } }
            : ("keep" as const);

      return reduce(
        withoutTree,
        {
          kind: "move-to",
          commit: purpose.target,
          abandoned,
          expect: purpose.revision ?? undefined,
        },
        now,
      );
    }

    case "tasks": {
      if (choice === "section:finished" || choice === "section:active") {
        const section = choice === "section:finished" ? "finished" : "active";
        const replaced = listDialog(closed, dialog.id, { kind: "tasks", section });

        return stay(withLocal(closed, { dialogs: [...closed.local.dialogs, replaced] }));
      }

      if (choice === null) return stay(state);

      if (msg.action === "chat.task.stop")
        return reduce(state, { kind: "stop-task", task: choice }, now);

      return openDialog(state, { kind: "inspector", task: choice }, now);
    }

    case "provider":
      if (choice === null) return stay(closed);

      return openDialog(closed, { kind: "auth", mode: purpose.mode, provider: choice }, now);
    default: {
      const _exhaustive: never = purpose;

      return _exhaustive;
    }
  }
}

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

const MOVE_REFUSALS = {
  busy: "Wait for the current run",
  "pending-input": "Send or remove the queued messages first",
  stale: "The chat moved on while the tree was open; try again",
  "missing-target": "Commit not found",
} as const;

/**
 * send-refused:  stage the snapshot as a handback (a plugin reject keeps the draft) and say why
 * withdrawn:     landed-first → "Already sent"; gone → "No longer queued"; withdrawn → "Removed from the queue"
 * answered:      !ok → "That question is no longer waiting"; a typed answer comes back to the composer
 * moved:         notice per outcome; a handed-back message lands in the composer
 * loaded:        routed to the dialog with that id; dropped when no such dialog is open (stale)
 * paste-resolved: generation matches the local paste generation? composer insert : drop
 * effect-failed: notice the error (the failure is already in the crash log) and release what it held
 */
export function outcomes(state: State, msg: Outcome, now: number): Step {
  const followed = state.facts.session;

  switch (msg.kind) {
    case "sent": {
      const submission = state.local.submissions.find(
        (candidate) => candidate.id === msg.submission,
      );

      const next = withLocal(state, {
        submissions: state.local.submissions.filter((candidate) => candidate.id !== msg.submission),
      });

      return submission?.replace === null || submission === undefined
        ? stay(next)
        : stay(withNotice(next, "Queued message saved.", "info", now));
    }

    case "send-refused": {
      const submission = state.local.submissions.find(
        (candidate) => candidate.id === msg.submission,
      );

      const next = withNotice(
        withLocal(state, {
          submissions: state.local.submissions.filter(
            (candidate) => candidate.id !== msg.submission,
          ),
        }),
        msg.reason,
        "warning",
        now,
      );

      const target = submission?.session ?? followed?.id;

      if (target === undefined) return stay(next);

      return stageHandback(
        next,
        target,
        { draft: msg.snapshot, notice: null, unlessLanded: null },
        now,
      );
    }

    case "revised":
      if (msg.result === "landed-first") return refuse(state, "Already sent", now);

      return msg.result === "gone" ? refuse(state, "No longer queued", now, "info") : stay(state);
    case "withdrawn":
      if (msg.result === "withdrawn")
        return stay(withNotice(state, "Removed from the queue", "info", now));

      return msg.result === "landed-first"
        ? refuse(state, "Already sent", now)
        : refuse(state, "No longer queued", now, "info");
    case "answered": {
      const next = msg.ok
        ? state
        : withNotice(state, "That question is no longer waiting", "warning", now);

      if (msg.ok || msg.typed === null || followed === null) return stay(next);

      return stageHandback(
        next,
        followed.id,
        { draft: msg.typed, notice: null, unlessLanded: null },
        now,
      );
    }

    case "moved":
      return moved(state, msg, now);
    case "run-stopped":
      return msg.result === "missing"
        ? refuse(state, "No active run to stop.", now, "info")
        : stay(state);
    case "loaded":
      return loaded(state, msg, now);
    case "load-failed":
      return stay(
        withLocal(state, {
          dialogs: state.local.dialogs.map((dialog): Dialog => {
            if (dialog.id !== msg.dialog) return dialog;
            const failed = { kind: "failed", message: msg.message } as const;

            switch (dialog.kind) {
              case "list":
                return { ...dialog, choices: failed };
              case "model":
                return { ...dialog, models: failed };
              case "tree":
                return { ...dialog, tree: failed };
              case "text":
                return { ...dialog, body: failed };
              default:
                return dialog;
            }
          }),
        }),
      );
    case "paste-resolved":
      return pasted(state, msg, now);
    case "editor-closed": {
      const next = withLocal(state, {
        pending: state.local.pending.filter((op) => op.kind !== "editor"),
      });

      return msg.text === null
        ? stay(next)
        : setDraft(next, { text: msg.text, parts: next.local.draft.parts });
    }

    case "op-finished": {
      const next = withLocal(state, {
        pending: state.local.pending.filter((op) => op.kind !== msg.op),
        dialogs:
          msg.op === "auth"
            ? state.local.dialogs.filter((dialog) => dialog.kind !== "auth")
            : state.local.dialogs,
      });

      return stay(msg.notice === null ? next : withLocal(next, { notice: msg.notice }));
    }

    case "effect-failed":
      return stay(withNotice(released(state, msg.effect), msg.message, "error", now));
    case "inform":
      return stay(withNotice(state, msg.text, msg.tone, now));
    case "preview-loaded": {
      const { draft } = state.local;
      const part = draft.parts.get(msg.marker);

      if (msg.body === null || part?.kind !== "file" || part.path !== msg.path) return stay(state);
      const parts = new Map(draft.parts).set(msg.marker, { ...part, body: msg.body });

      return stay(withLocal(state, { draft: { ...draft, parts } }));
    }

    case "directory-listed": {
      const current = state.local.completion;

      if (
        current.kind !== "open" ||
        current.token.trigger !== "cd" ||
        current.token.query !== msg.path
      )
        return stay(state);

      return stay(
        withLocal(state, {
          completion: { ...current, directories: { path: msg.path, entries: msg.entries } },
        }),
      );
    }

    default: {
      const _exhaustive: never = msg;

      return _exhaustive;
    }
  }
}

/** A failed effect releases the pending op it held, so the composer never stays blocked. */
function released(state: State, effect: string): State {
  const holds = new Map<string, PendingOp["kind"]>([
    ["follow", "switch"],
    ["change-directory", "cd"],
    ["login", "auth"],
    ["logout", "auth"],
    ["reload", "reload"],
    ["open-editor", "editor"],
  ]);

  const kind = holds.get(effect);

  if (kind === undefined) return state;

  return withLocal(state, {
    pending: state.local.pending.filter((op) => op.kind !== kind),
    dialogs:
      kind === "auth"
        ? state.local.dialogs.filter((dialog) => dialog.kind !== "auth")
        : state.local.dialogs,
  });
}

function moved(state: State, msg: Extract<Outcome, { kind: "moved" }>, now: number): Step {
  const context = state.local.move ?? { purpose: "tree" as const, message: null };
  const next = withLocal(state, { move: null });
  const followed = state.facts.session;
  const { outcome } = msg;

  if (outcome.kind === "moved") {
    const handback = outcome.handback === null ? msg.handback : draftFromContent(outcome.handback);

    if (handback !== null && followed !== null)
      return stageHandback(
        next,
        followed.id,
        {
          draft: handback,
          notice:
            context.purpose === "retract"
              ? "Stopped. Message is back in the composer."
              : "Message moved back to the composer. Enter sends it again.",
          unlessLanded: context.message,
        },
        now,
      );

    return context.purpose === "retract"
      ? stay(next)
      : stay(withNotice(next, "Moved. The next message starts a branch here.", "info", now));
  }

  if (context.purpose === "retract") return stay(next);

  return refuse(
    next,
    outcome.kind === "summary-failed" ? outcome.reason : MOVE_REFUSALS[outcome.kind],
    now,
    "error",
  );
}

function loaded(state: State, msg: Extract<Outcome, { kind: "loaded" }>, now: number): Step {
  const target = state.local.dialogs.find((dialog) => dialog.id === msg.dialog);

  if (target === undefined) return stay(state);
  const { data } = msg;
  let effects: readonly Effect[] = [];
  let pending = state.local.pending;

  const update = (dialog: Dialog): Dialog => {
    if (dialog.kind === "list" && data.kind === "list") return { ...dialog, choices: data.choices };

    if (dialog.kind === "list" && data.kind === "sessions") {
      const items = resumeChoices(state, data.sessions);

      return {
        ...dialog,
        purpose:
          dialog.purpose.kind === "resume"
            ? { kind: "resume", sessions: data.sessions.map((info) => info.id) }
            : dialog.purpose,
        choices: { kind: "ready", items },
        highlighted: initialHighlight(state, dialog.purpose, items),
      };
    }

    if (dialog.kind === "model" && data.kind === "models") return withModels(dialog, data.models);

    if (dialog.kind === "tree" && data.kind === "tree") return withTree(dialog, data.tree);

    if (dialog.kind === "text" && data.kind === "text")
      return { ...dialog, body: { kind: "ready", lines: data.lines } };

    if (dialog.kind === "auth" && data.kind === "auth") {
      if (data.step.kind === "link") {
        const { url } = data.step;
        effects = [{ kind: "open-external", target: url }];
        pending = pending.map((op) => (op.kind === "auth" ? { ...op, link: url } : op));
      }

      return withPrompt(dialog, data.step);
    }

    return dialog;
  };

  const next = withLocal(state, {
    dialogs: state.local.dialogs.map((dialog) =>
      dialog.id === msg.dialog ? update(dialog) : dialog,
    ),
    pending,
  });

  return {
    state:
      data.kind === "auth" && data.step.kind === "link"
        ? withNotice(next, linkNotice(data.step), "info", now)
        : next,
    effects,
  };
}

function linkNotice(step: { readonly url: string; readonly code: string | null }): string {
  return step.code === null
    ? `Open this URL to continue: ${step.url}`
    : `Visit ${step.url} and enter the code ${step.code}`;
}

function pasted(
  state: State,
  msg: Extract<Outcome, { kind: "paste-resolved" }>,
  now: number,
): Step {
  if (msg.generation !== state.local.pasteGeneration) return stay(state);
  const { insert } = msg;
  const { draft } = state.local;

  if (insert.kind === "refused") return refuse(state, insert.reason, now);

  if (insert.kind === "text") {
    const before = liveMarkers(draft).find((span) => span.to === draft.cursor);
    const part = before === undefined ? undefined : draft.parts.get(before.marker);

    if (before !== undefined && part?.kind === "paste" && part.text === insert.text)
      return replaceRange(state, before.from, before.to, insert.text);

    if (insert.text.split("\n").length <= PASTE_COLLAPSE_LINES)
      return insertText(state, insert.text, "cursor");
    const added = addPart(draft.parts, { kind: "paste", text: insert.text });

    return insertText(
      withLocal(state, { draft: { ...draft, parts: added.parts } }),
      added.marker,
      "cursor",
    );
  }

  const added = addPart(draft.parts, insert.part);

  return insertText(
    withLocal(state, { draft: { ...draft, parts: added.parts } }),
    added.marker,
    "cursor",
  );
}
