/**
 * Everything `reduce` accepts. Three vocabularies, disjoint `kind`s:
 *
 * - `Intent`: what the user asked for (keys via the interaction table, slash
 *   commands, palette, mouse, dialogs).
 * - `Fact`: what the world reports (views, watches, terminal, the textarea).
 * - `Outcome`: what an effect the reducer asked for came back with.
 */
import type {
  CommitId,
  Delivery,
  Json,
  MessageId,
  ModelCatalogView,
  MoveOutcome,
  PartId,
  Revision,
  SessionId,
  SessionInfo,
  SessionView,
} from "@nyte-ai/sdk";
import type { ChatCommand } from "../lib/constants.ts";
import type { ResolvedSettings, SettingsPatch } from "../lib/settings-schema.ts";
import type { Task } from "../lib/tasks.ts";
import type { MentionFile } from "./completion.ts";
import type { DialogData, DialogId, DialogInput, DialogRequest } from "./dialogs/dialog.ts";
import type { DraftInsert, DraftSnapshot } from "./draft.ts";
import type {
  FailureReport,
  Notice,
  Phase,
  Selection,
  ShellJob,
  TerminalFacts,
  WorkspaceFacts,
} from "./state.ts";

export type Intent =
  | {
      readonly kind: "send";
      readonly delivery: Delivery;
      /** Shown as a warning notice once the send is on its way (e.g. attachments sent instead of an answer). */
      readonly warning?: string;
    }
  | {
      readonly kind: "answer";
      readonly session: SessionId;
      readonly part: PartId;
      readonly choice: string;
      readonly typed: boolean;
    }
  | { readonly kind: "open-question" }
  | { readonly kind: "save-edit"; readonly delivery: Delivery }
  | { readonly kind: "cancel-edit" }
  | { readonly kind: "edit-queued"; readonly message: MessageId }
  | { readonly kind: "promote"; readonly message: MessageId }
  | { readonly kind: "withdraw"; readonly message: MessageId }
  | {
      readonly kind: "reorder";
      readonly message: MessageId;
      /** `before: null` moves the message to the end of the queue. */
      readonly to: "earlier" | "later" | { readonly before: MessageId | null };
    }
  | { readonly kind: "stop-run" }
  | { readonly kind: "run-shell"; readonly command: string; readonly include: boolean }
  | { readonly kind: "stop-shell" }
  | { readonly kind: "clear-draft" }
  | { readonly kind: "quit" }
  | { readonly kind: "escape-tree"; readonly at: number }
  | { readonly kind: "refuse"; readonly reason: string; readonly tone?: Notice["tone"] }
  | { readonly kind: "completion"; readonly action: CompletionAction }
  | { readonly kind: "copy-selection" }
  | { readonly kind: "history"; readonly direction: "previous" | "next" }
  | {
      readonly kind: "scroll";
      readonly to: "page-up" | "page-down" | "latest" | "previous-turn" | "next-turn";
    }
  | { readonly kind: "reveal-earlier" }
  | { readonly kind: "toggle-tool-output" }
  | { readonly kind: "toggle-disclosure"; readonly key: string }
  | { readonly kind: "cycle-thinking" }
  | { readonly kind: "cycle-model"; readonly direction: 1 | -1 }
  | { readonly kind: "open-editor" }
  | { readonly kind: "open-attachment" }
  /** The preview's title was clicked: the open attachment preview closes. */
  | { readonly kind: "close-preview" }
  | { readonly kind: "paste"; readonly source: PasteSource }
  /** Input aimed elsewhere (a paste over the transcript) belongs in the composer. */
  | { readonly kind: "focus-composer" }
  | { readonly kind: "open"; readonly dialog: DialogRequest }
  | { readonly kind: "dialog"; readonly command: DialogInput }
  | { readonly kind: "run-command"; readonly name: string; readonly argument: string }
  | {
      readonly kind: "switch-session";
      readonly session: SessionId | "new";
      readonly announce: boolean;
    }
  | { readonly kind: "retry-watch" }
  | { readonly kind: "change-directory"; readonly path: string }
  | { readonly kind: "reload" }
  | { readonly kind: "compact"; readonly instructions: string | null }
  | { readonly kind: "update"; readonly version: string | null }
  | { readonly kind: "configure"; readonly selection: Partial<Selection> }
  | { readonly kind: "write-settings"; readonly patch: SettingsPatch }
  /** A plugin setting's choice, applied on the host or the session per its scope. */
  | {
      readonly kind: "apply-setting";
      readonly id: string;
      /** The setting's label, for "Could not set <label>". */
      readonly label: string;
      readonly scope: "host" | "session";
      readonly value: Json;
    }
  | {
      readonly kind: "move-to";
      readonly commit: CommitId;
      readonly abandoned: "keep" | { readonly summarize: { readonly instructions: string | null } };
      /** The tree revision the user was shown; the move is refused as stale if the tree moved on. */
      readonly expect?: Revision;
    }
  | { readonly kind: "prefill"; readonly text: string }
  | { readonly kind: "stop-task"; readonly task: string }
  /** A key was pressed: the notice goes, and a finished run counts as seen (OSC 7501). */
  | { readonly kind: "dismiss-notice" }
  /** The table's verdict for a key that is ours but does nothing now (Enter on an empty draft). */
  | { readonly kind: "noop" }
  /** A list dialog accepted a row, the typed row, or a per-row action; `reduce` decides what that means. */
  | {
      readonly kind: "choose";
      readonly dialog: DialogId;
      readonly choice: string | null;
      readonly typed: string | null;
      readonly action: ChatCommand | null;
    }
  | { readonly kind: "cancel-auth" }
  | { readonly kind: "auth-answer"; readonly dialog: DialogId; readonly answer: string }
  | { readonly kind: "open-external"; readonly target: string }
  | { readonly kind: "copy-text"; readonly text: string }
  /**
   * A core-side plugin command, by name, with its typed argument. `delivery`
   * is the one the command line was sent with; when the plugin does not know
   * the command, it goes out as a message that way.
   */
  | {
      readonly kind: "plugin-command";
      readonly name: string;
      readonly argument: string;
      readonly delivery?: Delivery;
    }
  /** The task inspector's previous/next task. */
  | { readonly kind: "step-task"; readonly dialog: DialogId; readonly direction: -1 | 1 };

export type CompletionAction =
  /** `alternate`: after filling the token, send with this delivery (Ctrl+Enter on a skill). */
  | { readonly kind: "accept"; readonly alternate: Delivery | null }
  | { readonly kind: "fill" }
  | { readonly kind: "close" }
  | { readonly kind: "move"; readonly by: -1 | 1 | "page-up" | "page-down" }
  | { readonly kind: "pick"; readonly index: number };

export type PasteSource =
  | { readonly kind: "terminal"; readonly text: string; readonly bytes: Uint8Array | null }
  | { readonly kind: "clipboard" };

export type Fact =
  | { readonly kind: "phase"; readonly phase: Phase }
  | {
      readonly kind: "session-opened";
      readonly session: SessionId;
      readonly info: SessionInfo;
      readonly selection: Selection;
    }
  | { readonly kind: "view"; readonly session: SessionId; readonly view: SessionView }
  | { readonly kind: "watch-ended"; readonly session: SessionId; readonly failure: string | null }
  | { readonly kind: "session-info"; readonly session: SessionId; readonly info: SessionInfo }
  | { readonly kind: "selection"; readonly session: SessionId; readonly selection: Selection }
  | { readonly kind: "catalog"; readonly generation: number; readonly catalog: ModelCatalogView }
  | { readonly kind: "settings"; readonly settings: ResolvedSettings }
  | { readonly kind: "tasks"; readonly session: SessionId; readonly tasks: readonly Task[] }
  | { readonly kind: "workspace"; readonly workspace: WorkspaceFacts }
  | { readonly kind: "shell-job"; readonly job: ShellJob }
  | { readonly kind: "terminal"; readonly terminal: TerminalFacts }
  | {
      readonly kind: "draft-changed";
      readonly text: string;
      readonly cursor: number;
      readonly row: "only" | "first" | "middle" | "last";
    }
  | { readonly kind: "scrolled"; readonly atBottom: boolean }
  | { readonly kind: "failure"; readonly failure: FailureReport }
  | { readonly kind: "tick"; readonly now: number };

export type Outcome =
  | { readonly kind: "sent"; readonly submission: string; readonly message: MessageId }
  | {
      readonly kind: "send-refused";
      readonly submission: string;
      readonly reason: string;
      readonly snapshot: DraftSnapshot;
    }
  | {
      readonly kind: "revised";
      readonly message: MessageId;
      readonly result: "revised" | "landed-first" | "gone";
    }
  | {
      readonly kind: "withdrawn";
      readonly message: MessageId;
      readonly result: "withdrawn" | "landed-first" | "gone";
    }
  | {
      readonly kind: "answered";
      readonly part: PartId;
      readonly ok: boolean;
      readonly typed: DraftSnapshot | null;
    }
  | {
      readonly kind: "moved";
      readonly outcome: MoveOutcome;
      readonly handback: DraftSnapshot | null;
    }
  | { readonly kind: "run-stopped"; readonly result: "stopped" | "missing" }
  | { readonly kind: "loaded"; readonly dialog: DialogId; readonly data: DialogData }
  | { readonly kind: "load-failed"; readonly dialog: DialogId; readonly message: string }
  | { readonly kind: "paste-resolved"; readonly generation: number; readonly insert: DraftInsert }
  | { readonly kind: "editor-closed"; readonly text: string | null }
  | {
      readonly kind: "op-finished";
      readonly op: "switch" | "cd" | "auth" | "reload" | "editor";
      readonly notice: Notice | null;
    }
  | { readonly kind: "effect-failed"; readonly effect: string; readonly message: string }
  /** A notice an effect wants shown (compact started, nothing to compact, update progress, command output). */
  | { readonly kind: "inform"; readonly tone: Notice["tone"]; readonly text: string }
  /** A previewed file's body; null when it is binary, oversized or unreadable (the preview shows the path). */
  | {
      readonly kind: "preview-loaded";
      readonly marker: string;
      readonly path: string;
      readonly body: string | null;
    }
  /** `/cd` completion: the directories under `path`, as `directorySuggestions` returns them. */
  | {
      readonly kind: "directory-listed";
      readonly path: string;
      readonly entries: readonly string[];
    }
  /** The plugin did not know the command: the command line goes out as a message. */
  | {
      readonly kind: "command-unknown";
      readonly session: SessionId;
      readonly name: string;
      readonly argument: string | null;
      readonly delivery: Delivery;
    }
  /** `@` completion: the file or folder `query` names under `cwd`, or null. */
  | {
      readonly kind: "mention-resolved";
      readonly query: string;
      readonly cwd: string;
      readonly file: MentionFile | null;
    };

export type Msg = Intent | Fact | Outcome;
