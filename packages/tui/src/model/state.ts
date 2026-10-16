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
import type { ThemeMode } from "../lib/theme.ts";
import type { CompletionState, MentionFile } from "./completion.ts";
import type { Dialog } from "./dialogs/dialog.ts";
import type { ListDialog } from "./dialogs/list.ts";
import { NO_PARTS } from "./draft.ts";
import type { DraftParts, DraftSnapshot } from "./draft.ts";
import type { WindowStart } from "./window.ts";

export interface State {
  readonly facts: Facts;
  readonly local: Local;
}

export interface Facts {
  readonly phase: Phase;
  readonly session: FollowedSession | null;
  readonly catalog: CatalogFacts;
  readonly settings: ResolvedSettings;
  readonly tasks: readonly Task[];
  readonly shells: readonly ShellJob[];
  readonly workspace: WorkspaceFacts;
  readonly terminal: TerminalFacts;
  readonly remote: RemoteFacts;
}

export type RemoteFacts =
  | { readonly kind: "off" }
  | { readonly kind: "connecting" }
  | { readonly kind: "shared"; readonly devices: number }
  | { readonly kind: "interrupted" };

export type Phase =
  | { readonly kind: "starting" }
  | { readonly kind: "ready" }
  | { readonly kind: "closing" };

export interface FollowedSession {
  readonly id: SessionId;
  readonly info: SessionInfo;
  readonly view: SessionView | null;
  readonly watch:
    | { readonly kind: "live" }
    | { readonly kind: "failed"; readonly failure: string | null };
  readonly selection: Selection;
}

export interface Selection {
  readonly model: ModelRef;
  readonly effort: Thinking;
  readonly fast: boolean;
}

export interface CatalogFacts {
  readonly generation: number;
  readonly catalog: ModelCatalogView | null;
}

export interface ShellJob {
  readonly id: string;
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
  /** The mode the terminal reported, or `null` when it hasn't. */
  readonly theme: ThemeMode | null;
  readonly selection: boolean;
  readonly dragging: boolean;
}

export interface Local {
  readonly draft: Draft;
  readonly completion: CompletionState;
  readonly editing: Editing | null;
  readonly dialogs: readonly Dialog[];
  readonly question: QuestionLocal;
  readonly notice: Notice | null;
  readonly failures: readonly FailureReport[];
  readonly pending: readonly PendingOp[];
  readonly handbacks: Readonly<Record<SessionId, readonly Handback[]>>;
  readonly drafts: Readonly<Record<SessionId, DraftSnapshot>>;
  readonly edits: Readonly<Record<SessionId, Editing>>;
  readonly history: HistoryCursor | null;
  readonly escapeArmedAt: number | null;
  readonly transcript: TranscriptLocal;
  readonly submissions: readonly Submission[];
  readonly sequence: number;
  readonly pasteGeneration: number;
  readonly pasting: number;
  readonly sendAfterPaste: { readonly delivery: Delivery; readonly warning: string | null } | null;
  readonly watchedRun: RunId | null;
  readonly move: MoveContext | null;
  readonly preview: string | null;
}

export interface MoveContext {
  readonly purpose: "retract" | "tree";
  readonly message: MessageId | null;
}

export interface Draft {
  readonly text: string;
  readonly cursor: number;
  readonly row: "only" | "first" | "middle" | "last";
  readonly parts: DraftParts;
}

export interface Editing {
  readonly message: MessageId;
  readonly delivery: "steer" | "queue";
  readonly saved: DraftSnapshot;
}

export interface QuestionRequest {
  readonly session: SessionId;
  readonly part: PartId;
}

export type QuestionFieldDraft =
  | {
      readonly kind: "single";
      readonly selection:
        | { readonly kind: "empty" }
        | { readonly kind: "option"; readonly value: string }
        | { readonly kind: "custom" };
      readonly customText: string;
    }
  | {
      readonly kind: "multiple";
      readonly options: readonly string[];
      readonly customText: string;
      readonly customSelected: boolean;
    };

export interface QuestionDraft {
  readonly active: number;
  readonly fields: readonly QuestionFieldDraft[];
  readonly phase: "editing" | "submitting" | "answered";
}

export interface QuestionTypedDraft {
  readonly session: SessionId;
  readonly draft: DraftSnapshot;
}

export interface QuestionLocal {
  readonly detailScroll?: {
    readonly part: PartId;
    readonly index: number;
    readonly request: NonNullable<ListDialog["detailScroll"]>;
  };
  readonly dismissed: QuestionRequest | null;
  readonly highlighted: number;
  readonly drafts: ReadonlyMap<SessionId, ReadonlyMap<PartId, QuestionDraft>>;
}

export interface Notice {
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
  readonly disclosures: ReadonlySet<string>;
}

export interface Submission {
  readonly id: string;
  readonly session: SessionId;
  readonly snapshot: DraftSnapshot;
  readonly replace: MessageId | null;
}

interface Bootstrap {
  readonly cwd: string;
  readonly settings: ResolvedSettings;
  readonly terminal: TerminalFacts;
}

const EMPTY_DRAFT: Draft = { text: "", cursor: 0, row: "only", parts: NO_PARTS };

export function initialState(bootstrap: Bootstrap): State {
  return {
    facts: {
      phase: { kind: "starting" },
      session: null,
      catalog: { generation: -1, catalog: null },
      settings: bootstrap.settings,
      tasks: [],
      shells: [],
      workspace: { cwd: bootstrap.cwd, branch: null, dirty: false, mentions: null },
      terminal: bootstrap.terminal,
      remote: { kind: "off" },
    },
    local: {
      draft: EMPTY_DRAFT,
      completion: { kind: "closed", dismissed: null },
      editing: null,
      dialogs: [],
      question: { dismissed: null, highlighted: 0, drafts: new Map() },
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

export function followedShells(state: State): readonly ShellJob[] {
  const followed = state.facts.session?.id ?? null;

  return state.facts.shells.filter((job) => job.session === followed);
}
