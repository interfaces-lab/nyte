/**
 * Facts in, transitions out. Everything that used to be a side effect of
 * `render`/`flushVisual` (retracting a stopped prompt, landing a handback,
 * re-asking a question, cancelling an edit whose message landed) is a pure
 * comparison between the previous facts and the new ones.
 */
import type { MessageId, SessionId, SessionView } from "@nyte-ai/sdk";
import { shortId } from "../lib/format.ts";
import { CLOSED, explicitMentionQuery, nextCompletion } from "./completion.ts";
import { addPart } from "./draft.ts";
import type { Fact } from "./msg.ts";
import { currentQuestion } from "./question.ts";
import type { Step } from "./reduce.ts";
import { followedShells } from "./state.ts";
import type { Handback, ShellJob, State } from "./state.ts";
import { andThen, insertText, setDraft, stay, withFacts, withLocal, withNotice } from "./step.ts";
import { deriveTranscript } from "./transcript.ts";
import { anchorAt } from "./window.ts";

export function facts(state: State, msg: Fact, now: number): Step {
  switch (msg.kind) {
    case "phase":
      return stay(withFacts(state, { phase: msg.phase }));
    case "session-opened":
      return stay(opened(state, msg));
    case "view":
      return viewArrived(state, msg.session, msg.view, now);
    case "watch-ended": {
      const session = state.facts.session;

      if (session?.id !== msg.session) return stay(state);

      return stay(
        withFacts(state, {
          session: { ...session, watch: { kind: "failed", failure: msg.failure } },
        }),
      );
    }

    case "session-info": {
      const session = state.facts.session;

      return session?.id === msg.session
        ? stay(withFacts(state, { session: { ...session, info: msg.info } }))
        : stay(state);
    }

    case "selection": {
      const session = state.facts.session;

      return session?.id === msg.session
        ? stay(withFacts(state, { session: { ...session, selection: msg.selection } }))
        : stay(state);
    }

    case "catalog":
      return msg.generation < state.facts.catalog.generation
        ? stay(state)
        : stay(withFacts(state, { catalog: { generation: msg.generation, catalog: msg.catalog } }));
    case "settings":
      return stay(withFacts(state, { settings: msg.settings }));
    case "tasks":
      if (state.facts.session?.id !== msg.session) return stay(state);

      return stay(questionMoved(state, withFacts(state, { tasks: msg.tasks })));
    case "workspace":
      return stay(
        withLocal(withFacts(state, { workspace: msg.workspace }), {
          pasteGeneration:
            msg.workspace.cwd === state.facts.workspace.cwd
              ? state.local.pasteGeneration
              : state.local.pasteGeneration + 1,
        }),
      );
    case "shell-job":
      return shellReported(state, msg.job);
    case "terminal":
      return stay(withFacts(state, { terminal: msg.terminal }));
    case "draft-changed":
      return draftChanged(state, msg, now);
    case "scrolled":
      return stay(scrolled(state, msg.atBottom));
    case "failure":
      return stay(withLocal(state, { failures: [...state.local.failures, msg.failure] }));
    case "tick":
      return stay(state);
    default: {
      const _exhaustive: never = msg;

      return _exhaustive;
    }
  }
}

function opened(state: State, msg: Extract<Fact, { kind: "session-opened" }>): State {
  const next = withFacts(state, {
    session: {
      id: msg.session,
      info: msg.info,
      view: null,
      watch: { kind: "live" },
      selection: msg.selection,
    },
    tasks: [],
  });

  return withLocal(next, {
    question: { dismissed: null, highlighted: 0, query: "", answering: null },
    transcript: {
      ...state.local.transcript,
      following: true,
      window: { kind: "tail" },
      disclosures: new Set(),
    },
    completion: CLOSED,
    history: null,
    escapeArmedAt: null,
    watchedRun: null,
  });
}

function viewArrived(state: State, id: SessionId, view: SessionView, now: number): Step {
  const session = state.facts.session;

  if (session === null || session.id !== id) return stay(state);
  const before = session.view;
  let next = withFacts(state, { session: { ...session, view } });

  if (view.execution.kind !== "idle") next = withLocal(next, { watchedRun: view.execution.run.id });
  next = questionMoved(state, next);
  let step: Step = stay(next);

  if (before === null) step = andThen(step, (current) => firstView(current, now));
  step = andThen(step, (current) => runEnded(before, view, current, now));
  step = andThen(step, (current) => editLanded(current, now));

  return andThen(step, (current) => landHandback(current, now));
}

/** A different question took the panel: its highlight, filter and typed answer start fresh. */
function followedHead(
  state: State,
): { readonly id: SessionId; readonly view: SessionView | null } | null {
  return state.facts.session === null
    ? null
    : { id: state.facts.session.id, view: state.facts.session.view };
}

function questionMoved(before: State, after: State): State {
  const previous = currentQuestion(followedHead(before), before.facts.tasks, before.local.question);
  const current = currentQuestion(followedHead(after), after.facts.tasks, after.local.question);

  if (previous?.part === current?.part) return after;

  return withLocal(after, {
    question: { ...after.local.question, highlighted: 0, query: "", answering: null },
  });
}

function firstView(state: State, now: number): Step {
  const session = state.facts.session;

  if (session === null) return stay(state);
  const switching = state.local.pending.find((op) => op.kind === "switch");

  let next = withLocal(state, {
    pending: state.local.pending.filter((op) => op.kind !== "switch"),
  });

  if (switching?.kind === "switch" && switching.announce)
    next = withNotice(
      next,
      `Resumed ${shortId(session.id)} · ${String(session.view?.turns.length ?? 0)} turns`,
      "info",
      now,
    );
  const saved = next.local.drafts[session.id];

  if (saved === undefined || next.local.draft.text !== "") return deliverShells(next);

  const drafts = Object.fromEntries(
    Object.entries(next.local.drafts).filter(([key]) => key !== session.id),
  );

  const edits = Object.fromEntries(
    Object.entries(next.local.edits).filter(([key]) => key !== session.id),
  );

  const restored = withLocal(next, {
    drafts,
    edits,
    editing: next.local.edits[session.id] ?? null,
  });

  return andThen(setDraft(restored, saved), deliverShells);
}

/** The last turn's lone landed prompt, which a stop before any answer hands back. */
export function unansweredRequest(
  view: SessionView,
): { readonly message: MessageId; readonly commit: string } | null {
  const turn = view.turns.at(-1);

  if (turn === undefined || turn.prompt === null) return null;
  const messages = view.messages.filter((message) => message.turn === turn.id);
  const only = messages[0];

  return messages.length === 1 && only?.kind === "user" && only.status.kind === "landed"
    ? { message: only.id, commit: only.status.commit }
    : null;
}

/**
 * On a busy → idle transition of the followed head:
 * - failed → notice "Error: <message>"
 * - stopped, composer empty, not editing → retract: the last turn's lone landed user message
 *   (unansweredRequest) moves back: effect move(position at it) whose outcome hands its
 *   content back with "Stopped. Message is back in the composer."
 * - any end → effect refresh-workspace (git status)
 */
export function runEnded(
  before: SessionView | null,
  after: SessionView,
  next: State,
  now: number,
): Step {
  const session = next.facts.session;

  if (
    before === null ||
    before.execution.kind === "idle" ||
    after.execution.kind !== "idle" ||
    session === null
  )
    return stay(next);
  const end = after.execution.lastRun?.end;

  const refresh: Step = {
    state: next,
    effects: [{ kind: "refresh-workspace", cwd: next.facts.workspace.cwd }],
  };

  if (end?.kind === "failed")
    return { ...refresh, state: withNotice(next, `Error: ${end.failure.message}`, "error", now) };

  if (end?.kind !== "stopped" || next.local.draft.text.trim() !== "" || next.local.editing !== null)
    return refresh;
  const request = unansweredRequest(after);
  const commit = after.messages.find((message) => message.id === request?.message);

  if (request === null || commit?.kind !== "user" || commit.status.kind !== "landed")
    return refresh;

  return {
    state: withLocal(next, { move: { purpose: "retract", message: request.message } }),
    effects: [
      ...refresh.effects,
      {
        kind: "move",
        session: session.id,
        position: { kind: "commit", id: commit.status.commit },
        options: {},
        handback: null,
      },
    ],
  };
}

/** Editing a queued message that has since landed: the edit ends, the text stays. */
function editLanded(state: State, now: number): Step {
  const { editing } = state.local;
  const view = state.facts.session?.view;

  if (editing === null || view === null || view === undefined) return stay(state);

  const stillQueued = view.messages.some(
    (message) =>
      message.id === editing.message && message.kind === "user" && message.status.kind !== "landed",
  );

  if (stillQueued) return stay(state);

  return stay(
    withNotice(
      withLocal(state, { editing: null }),
      "That message was sent before the edit was saved; your text stays in the composer.",
      "warning",
      now,
    ),
  );
}

/** Queues a handback for its session; the followed session lands it as soon as it can. */
export function stageHandback(
  state: State,
  session: SessionId,
  handback: Handback,
  now: number,
): Step {
  const handbacks = state.local.handbacks[session] ?? [];

  return landHandback(
    withLocal(state, {
      handbacks: { ...state.local.handbacks, [session]: [...handbacks, handback] },
    }),
    now,
  );
}

function shownLanded(view: SessionView, message: MessageId): boolean {
  return view.messages.some(
    (candidate) =>
      candidate.id === message && candidate.kind === "user" && candidate.status.kind === "landed",
  );
}

/**
 * Lands the head handback of the followed session when: the draft is empty,
 * no dialog is open, nothing is being edited, and `unlessLanded` is not drawn
 * as landed in the view. Emits `composer set` and drops it from the list.
 * Idempotent: the mirror then holds the handback's text, so running it again
 * on the result lands nothing.
 */
export function landHandback(next: State, now: number): Step {
  const session = next.facts.session;
  const view = session?.view;

  if (session === null || view === null || view === undefined) return stay(next);
  const [head, ...rest] = next.local.handbacks[session.id] ?? [];

  if (head === undefined) return stay(next);

  if (
    next.local.draft.text.trim() !== "" ||
    next.local.dialogs.length > 0 ||
    next.local.editing !== null
  )
    return stay(next);

  if (head.unlessLanded !== null && shownLanded(view, head.unlessLanded)) return stay(next);

  const dropped = withLocal(next, {
    handbacks: { ...next.local.handbacks, [session.id]: rest },
    history: null,
  });

  const landed = setDraft(dropped, head.draft);

  return head.notice === null
    ? landed
    : { ...landed, state: withNotice(landed.state, head.notice, "ok", now) };
}

function shellReported(state: State, job: ShellJob): Step {
  const known = state.facts.shells.find((candidate) => candidate.id === job.id);
  const reported = { ...job, delivered: known?.delivered ?? job.delivered };

  const shells =
    known === undefined
      ? [...state.facts.shells, reported]
      : state.facts.shells.map((candidate) => (candidate.id === job.id ? reported : candidate));

  return deliverShells(withFacts(state, { shells }));
}

/**
 * Finished `!commands` of the followed chat that send their output with the
 * next prompt: each marker goes at the front of its chat's draft once
 * (`delivered`). With a dialog open it waits for the next finish or for the
 * chat to be followed again.
 */
export function deliverShells(state: State): Step {
  if (state.local.dialogs.length > 0) return stay(state);

  return followedShells(state).reduce<Step>((step, job) => {
    if (!job.include || job.delivered || job.state.kind !== "exited") return step;
    const exit = job.state.code;

    return andThen(step, (current) => {
      const shells = current.facts.shells.map((candidate) =>
        candidate.id === job.id ? { ...candidate, delivered: true } : candidate,
      );

      const added = addPart(current.local.draft.parts, {
        kind: "shell",
        command: job.command,
        output: job.output,
        exit,
      });

      return insertText(
        withLocal(withFacts(current, { shells }), {
          draft: { ...current.local.draft, parts: added.parts },
        }),
        `${added.marker} `,
        "start",
      );
    });
  }, stay(state));
}

function draftChanged(
  state: State,
  msg: Extract<Fact, { kind: "draft-changed" }>,
  now: number,
): Step {
  const { draft } = state.local;
  const changed = msg.text !== draft.text;
  const mirror = { text: msg.text, cursor: msg.cursor, row: msg.row, parts: draft.parts };
  const completion = nextCompletion(state.local.completion, mirror);
  const preview = state.local.preview;

  const next = withLocal(state, {
    draft: mirror,
    completion,
    history: changed ? null : state.local.history,
    preview: preview !== null && !msg.text.includes(preview) ? null : preview,
  });

  const lookup = completionLookup(state.local.completion, next);

  return andThen(lookup, (current) => landHandback(current, now));
}

/**
 * A completion whose query it has not asked about yet asks the runner: a
 * `/cd` listing, or what an `@` query spelled as a path names on disk.
 */
export function completionLookup(before: State["local"]["completion"], next: State): Step {
  const after = next.local.completion;

  if (after.kind !== "open" || after.directories !== null || after.explicit !== null)
    return stay(next);

  if (
    before.kind === "open" &&
    before.token.trigger === after.token.trigger &&
    before.token.query === after.token.query
  )
    return stay(next);
  const { cwd } = next.facts.workspace;

  if (after.token.trigger === "cd")
    return { state: next, effects: [{ kind: "list-directory", path: after.token.query, cwd }] };

  if (after.token.trigger === "@" && explicitMentionQuery(after.token.query))
    return { state: next, effects: [{ kind: "resolve-mention", query: after.token.query, cwd }] };

  return stay(next);
}

/** The scrollbox's stickiness mirrored: at the bottom the window follows the tail, away from it the first row is held. */
function scrolled(state: State, atBottom: boolean): State {
  const { transcript } = state.local;

  if (atBottom)
    return withLocal(state, {
      transcript: { ...transcript, following: true, window: { kind: "tail" } },
    });

  if (transcript.window.kind !== "tail")
    return withLocal(state, { transcript: { ...transcript, following: false } });

  const model = deriveTranscript(
    state.facts.session?.view ?? null,
    followedShells(state),
    transcript,
    null,
  );

  return withLocal(state, {
    transcript: { ...transcript, following: false, window: anchorAt(model.rows, model.window) },
  });
}
