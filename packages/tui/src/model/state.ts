import type {
  Delivery,
  MessageId,
  ModelCatalogView,
  PartId,
  RunId,
  SessionId,
  SessionInfo,
  SettingInfo,
  Thinking,
  ModelRef,
  WorkspaceCatalogView,
  WorkspaceId,
} from "@nyte-ai/sdk";
import type { Freshness, HeadView, Health } from "@nyte-ai/sdk/client";
import type { ResolvedSettings } from "../lib/settings-schema.ts";
import type { Task } from "../lib/tasks.ts";
import type { ThemeMode } from "../lib/theme.ts";
import type { CompletionState, MentionFile } from "./completion.ts";
import type { Dialog } from "./dialogs/dialog.ts";
import type { ListDialog } from "./dialogs/list.ts";
import { NO_PARTS } from "./draft.ts";
import type { DraftParts, DraftSnapshot } from "./draft.ts";
import { rowMessage } from "./queue.ts";
import type { WindowStart } from "./window.ts";

export interface State {
  readonly facts: Facts;
  readonly local: Local;
}

export interface Facts {
  readonly host: "opening" | "open";
  readonly health: Health;
  readonly chat: Chat | null;
  readonly catalog: CatalogFacts;
  readonly hostSettings: readonly SettingInfo[];
  readonly folderCatalog: FolderCatalog | null;
  readonly settings: ResolvedSettings;
  readonly tasks: readonly Task[];
  readonly shells: readonly ShellJob[];
  readonly workspace: WorkspaceFacts;
  readonly terminal: TerminalFacts;
  readonly focused: boolean;
}

export type Chat = BlankChat | FollowedSession;

export interface BlankChat {
  readonly kind: "blank";
  readonly id: SessionId;
  readonly folder: ChatFolder;
  readonly selection: Selection;
  readonly unresolved?: true;
}

export type ChatFolder =
  | { readonly kind: "launch-folder" }
  | { readonly kind: "folder"; readonly id: WorkspaceId };

export interface FollowedSession {
  readonly kind: "session";
  readonly id: SessionId;
  readonly info: SessionInfo;
  readonly view: HeadView | null;
  readonly freshness: Freshness | null;
  readonly selection: Selection;
}

export interface Selection {
  readonly model: ModelRef;
  readonly effort: Thinking;
  readonly fast: boolean;
}

interface FolderCatalog {
  readonly generation: number;
  readonly workspace: WorkspaceId;
  readonly catalog: WorkspaceCatalogView;
}

interface CatalogFacts {
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
  readonly theme: ThemeMode | null;
  readonly selection: boolean;
  readonly dragging: boolean;
  readonly hyperlinks: boolean;
}

export interface Local {
  readonly draft: Draft;
  readonly completion: CompletionState;
  readonly editing: Editing | null;
  readonly dialogs: readonly Dialog[];
  readonly question: QuestionLocal;
  readonly approval: ApprovalLocal;
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
  readonly settlingTrust: readonly WorkspaceId[];
  readonly sequence: number;
  readonly pasteGeneration: number;
  readonly pasting: number;
  readonly sendAfterPaste: { readonly delivery: Delivery; readonly warning: string | null } | null;
  readonly watchedRun: RunId | null;
  readonly move: MoveContext | null;
  readonly preview: string | null;
}

interface MoveContext {
  readonly purpose: "retract" | "tree";
  readonly message: MessageId | null;
}

export interface Draft {
  readonly text: string;
  readonly cursor: number;
  readonly row: "only" | "first" | "middle" | "last";
  readonly parts: DraftParts;
}

interface Editing {
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

export interface ApprovalLocal {
  readonly part: PartId | null;
  readonly highlighted: number;
  readonly sending: PartId | null;
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

interface HistoryCursor {
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
  readonly chat: BlankChat | null;
}

const EMPTY_DRAFT: Draft = { text: "", cursor: 0, row: "only", parts: NO_PARTS };

export function initialState(bootstrap: Bootstrap): State {
  return {
    facts: {
      host: "opening",
      health: { kind: "connecting" },
      chat: bootstrap.chat,
      catalog: { generation: -1, catalog: null },
      hostSettings: [],
      folderCatalog: null,
      settings: bootstrap.settings,
      tasks: [],
      shells: [],
      workspace: { cwd: bootstrap.cwd, branch: null, dirty: false, mentions: null },
      terminal: bootstrap.terminal,
      focused: true,
    },
    local: {
      draft: EMPTY_DRAFT,
      completion: { kind: "closed", dismissed: null },
      editing: null,
      dialogs: [],
      question: { dismissed: null, highlighted: 0, drafts: new Map() },
      approval: { part: null, highlighted: 0, sending: null },
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
      settlingTrust: [],
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

export function chatFolder(chat: Chat): ChatFolder {
  return chat.kind === "blank" ? chat.folder : { kind: "folder", id: chat.info.workspace };
}

export function awaitingTrust(state: State, workspace: WorkspaceId): boolean {
  return (
    state.local.settlingTrust.includes(workspace) ||
    state.local.dialogs.some(
      (dialog) =>
        dialog.kind === "list" &&
        dialog.purpose.kind === "trust" &&
        dialog.purpose.workspace === workspace,
    )
  );
}

export function followedSession(state: State): FollowedSession | null {
  const { chat } = state.facts;

  return chat?.kind === "session" ? chat : null;
}

export function rowStatus(
  state: State,
  session: SessionId,
  message: MessageId,
): "pending" | "landed" | "unsent" | "absent" {
  const followed = followedSession(state);

  if (followed === null || followed.id !== session) return "absent";

  return rowMessage(followed, message)?.status.kind ?? "absent";
}

export function followedShells(state: State): readonly ShellJob[] {
  const followed = state.facts.chat?.id ?? null;

  return state.facts.shells.filter((job) => job.session === followed);
}
