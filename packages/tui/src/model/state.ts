/**
 * The whole interactive state: what the outside world told us (`facts`) and
 * what the user did here (`local`). One immutable value, one writer: `reduce`.
 * Everything drawn is `deriveScreen(state)`; nothing below is a cache of
 * something derivable.
 */
import type {
  Delivery,
  MessageId,
  ModelCatalogView,
  PartId,
  RunId,
  SessionId,
  SessionInfo,
  SessionView,
  Thinking,
  ModelRef,
} from "@nyte-ai/sdk";
import type { ResolvedSettings } from "../lib/settings-schema.ts";
import type { Task } from "../lib/tasks.ts";
import type { CompletionState, MentionFile } from "./completion.ts";
import type { Dialog } from "./dialogs/dialog.ts";
import { NO_PARTS } from "./draft.ts";
import type { DraftParts, DraftSnapshot } from "./draft.ts";
import type { WindowStart } from "./window.ts";

export interface State {
  readonly facts: Facts;
  readonly local: Local;
}

/** Written only by `reduce` from `Fact` messages the effects runner forwards. */
export interface Facts {
  readonly phase: Phase;
  readonly session: FollowedSession | null;
  readonly catalog: CatalogFacts;
  readonly settings: ResolvedSettings;
  readonly tasks: readonly Task[];
  readonly shells: readonly ShellJob[];
  readonly workspace: WorkspaceFacts;
  readonly terminal: TerminalFacts;
}

export type Phase =
  | { readonly kind: "starting"; readonly step: "workspace" | "settings" | "providers" }
  | { readonly kind: "ready" }
  | { readonly kind: "closing" };

/** The followed head. `view` is null between `follow` and the first frame ("Loading session…"). */
export interface FollowedSession {
  readonly id: SessionId;
  readonly info: SessionInfo;
  readonly view: SessionView | null;
  /**
   * `failed`: the watch threw (`failure`) or ended (`null`). Drawn as the
   * failure line with a retry (`retry-watch` intent), never a dead loop.
   */
  readonly watch:
    | { readonly kind: "live" }
    | { readonly kind: "failed"; readonly failure: string | null };
  /** The configurator's optimistic selection; the footer and Shift+Tab read it, never `view.configuration` directly. */
  readonly selection: Selection;
}

export interface Selection {
  readonly model: ModelRef;
  readonly effort: Thinking;
  readonly fast: boolean;
}

export interface CatalogFacts {
  /** The generation the catalog below was listed for; an older listing that resolves late is dropped. */
  readonly generation: number;
  readonly catalog: ModelCatalogView | null;
}

/** A local `!` command. The runner owns the process; these rows are what it reported. */
export interface ShellJob {
  readonly id: string;
  /** The chat it ran in: its card and its result marker belong to that chat only. */
  readonly session: SessionId | null;
  readonly command: string;
  readonly include: boolean;
  readonly startedAt: number;
  readonly output: string;
  readonly state:
    | { readonly kind: "running" }
    | { readonly kind: "exited"; readonly code: number }
    | { readonly kind: "signalled"; readonly signal: string }
    | { readonly kind: "cancelled" }
    | { readonly kind: "failed"; readonly message: string };
  /** Set once its marker went into the draft, so it is inserted exactly once. */
  readonly delivered: boolean;
}

export interface WorkspaceFacts {
  readonly cwd: string;
  readonly branch: string | null;
  readonly dirty: boolean;
  readonly mentions: readonly MentionFile[] | null;
}

export interface TerminalFacts {
  readonly width: number;
  readonly height: number;
  readonly theme: "dark" | "light";
  readonly selection: boolean;
  readonly dragging: boolean;
}

/** Written only by `reduce` from `Intent` and `Outcome` messages. */
export interface Local {
  readonly draft: Draft;
  readonly completion: CompletionState;
  readonly editing: Editing | null;
  readonly dialogs: readonly Dialog[];
  readonly question: QuestionLocal;
  readonly notice: Notice | null;
  readonly failures: readonly FailureReport[];
  /** One list for "something is in flight that blocks the composer"; `blocked` is derived from it. */
  readonly pending: readonly PendingOp[];
  readonly handbacks: Readonly<Record<SessionId, readonly Handback[]>>;
  readonly drafts: Readonly<Record<SessionId, DraftSnapshot>>;
  /** A queue edit left open in another chat; it comes back with that chat's draft. */
  readonly edits: Readonly<Record<SessionId, Editing>>;
  readonly history: HistoryCursor | null;
  readonly escapeArmedAt: number | null;
  readonly transcript: TranscriptLocal;
  readonly submissions: readonly Submission[];
  /** Counter for ids `reduce` mints (dialogs, submissions, shell jobs), so reduce stays pure. */
  readonly sequence: number;
  /** Bumped on a session switch or directory change; a paste resolved for an older generation is dropped. */
  readonly pasteGeneration: number;
  /** Pastes the runner is still resolving. */
  readonly pasting: number;
  /** A send pressed while pastes were resolving; it goes once the last lands, and a refused paste cancels it. */
  readonly sendAfterPaste: { readonly delivery: Delivery; readonly warning: string | null } | null;
  /** The run this client watched while it was live; OSC 7501 reports `done`/`error` only for it, until a key marks it seen. */
  readonly watchedRun: RunId | null;
  /** The move in flight, so its outcome lands the handback with the right notice. */
  readonly move: MoveContext | null;
  /** The marker whose preview (file, image, shell output) is open under the composer. */
  readonly preview: string | null;
}

export interface MoveContext {
  readonly purpose: "retract" | "tree";
  /** The landed user message the move hands back; its handback waits until the view no longer shows it landed. */
  readonly message: MessageId | null;
}

/**
 * The textarea owns the text. `text`, `cursor` and `row` are its mirror,
 * written only by the Composer's `draft-changed` fact (and refreshed
 * synchronously before every key decision). `parts` is owned here.
 */
export interface Draft {
  readonly text: string;
  readonly cursor: number;
  readonly row: "only" | "first" | "middle" | "last";
  readonly parts: DraftParts;
}

export interface Editing {
  readonly message: MessageId;
  readonly delivery: "steer" | "queue";
  /** The draft the user had before opening the edit; restored on cancel. */
  readonly saved: DraftSnapshot;
}

export interface QuestionLocal {
  /** The question the user pressed Esc on ("later"); the panel stays closed for that part only. */
  readonly dismissed: PartId | null;
  readonly highlighted: number;
  /** The panel's filter text. */
  readonly query: string;
  /** The typed answer while the "Type an answer" row is active; null otherwise. */
  readonly answering: string | null;
  /** The caret in the typed answer; absent at the end. */
  readonly caret?: number;
}

export interface Notice {
  /** `ok` confirms a change took (model, level, theme, directory, move, sign-in, reload, handback). */
  readonly tone: "info" | "ok" | "warning" | "error";
  readonly text: string;
  readonly at: number;
}

export interface FailureReport {
  readonly origin: "render" | "effect" | "reducer" | "watch" | "plugin" | "process";
  readonly message: string;
  readonly logPath: string;
}

export type PendingOp =
  | { readonly kind: "switch"; readonly session: SessionId | "new"; readonly announce: boolean }
  | { readonly kind: "cd"; readonly path: string }
  | { readonly kind: "auth"; readonly provider: string; readonly link: string | null }
  | { readonly kind: "reload" }
  | { readonly kind: "editor" };

/** Text to put back in the composer once it is empty and `commit` is no longer drawn as landed. */
export interface Handback {
  readonly draft: DraftSnapshot;
  readonly notice: string | null;
  readonly unlessLanded: MessageId | null;
}

export interface HistoryCursor {
  readonly index: number;
  readonly saved: DraftSnapshot;
}

export interface TranscriptLocal {
  readonly following: boolean;
  readonly window: WindowStart;
  readonly toolOutput: "collapsed" | "expanded";
  /** Keys are `${messageId}:${local}`, never shared between messages. */
  readonly disclosures: ReadonlySet<string>;
}

/** A send between "draft cleared" and "receipt or refusal". Never blocks typing. */
export interface Submission {
  readonly id: string;
  readonly session: SessionId;
  readonly snapshot: DraftSnapshot;
  /** Saving an edit of a queued message: send with `replace` (the runner re-checks it is still pending). */
  readonly replace: MessageId | null;
}

export interface Bootstrap {
  readonly cwd: string;
  readonly settings: ResolvedSettings;
  readonly terminal: TerminalFacts;
}

export const EMPTY_DRAFT: Draft = { text: "", cursor: 0, row: "only", parts: NO_PARTS };

export function initialState(bootstrap: Bootstrap): State {
  return {
    facts: {
      phase: { kind: "starting", step: "workspace" },
      session: null,
      catalog: { generation: -1, catalog: null },
      settings: bootstrap.settings,
      tasks: [],
      shells: [],
      workspace: { cwd: bootstrap.cwd, branch: null, dirty: false, mentions: null },
      terminal: bootstrap.terminal,
    },
    local: {
      draft: EMPTY_DRAFT,
      completion: { kind: "closed", dismissed: null },
      editing: null,
      dialogs: [],
      question: { dismissed: null, highlighted: 0, query: "", answering: null },
      notice: null,
      failures: [],
      pending: [],
      handbacks: {},
      drafts: {},
      edits: {},
      history: null,
      escapeArmedAt: null,
      transcript: {
        following: true,
        window: { kind: "tail" },
        toolOutput: "collapsed",
        disclosures: new Set(),
      },
      submissions: [],
      sequence: 0,
      pasteGeneration: 0,
      pasting: 0,
      sendAfterPaste: null,
      watchedRun: null,
      move: null,
      preview: null,
    },
  };
}

/** The `!` commands run in the followed chat, the ones its transcript and draft show. */
export function followedShells(state: State): readonly ShellJob[] {
  const followed = state.facts.session?.id ?? null;

  return state.facts.shells.filter((job) => job.session === followed);
}
