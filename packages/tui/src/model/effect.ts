/**
 * What `reduce` asks the outside world to do, as data. The runner executes
 * each one against a port and answers with `Outcome`/`Fact` messages.
 * Effects name IO, not user intent: `withdraw` here is "stop receipt X if it
 * is still pending", never "the user pressed Ctrl+D".
 */
import type {
  Delivery,
  Json,
  MessageId,
  MoveOptions,
  PartId,
  Position,
  RunId,
  SessionId,
  UserContent,
} from "@nyte-ai/sdk";
import type { SettingsPatch } from "../lib/settings-schema.ts";
import type { DialogId, LoadRequest } from "./dialogs/dialog.ts";
import type { DraftSnapshot } from "./draft.ts";
import type { Selection, Submission } from "./state.ts";

export type Effect =
  | { readonly kind: "follow"; readonly target: SessionId | "new"; readonly announce: boolean }
  | { readonly kind: "send"; readonly submission: Submission; readonly delivery: Delivery }
  | {
      readonly kind: "revise";
      readonly session: SessionId;
      readonly message: MessageId;
      readonly content: UserContent;
      readonly delivery: Delivery;
      readonly position:
        | { readonly kind: "last" }
        | { readonly kind: "before"; readonly message: MessageId }
        | null;
    }
  | { readonly kind: "withdraw"; readonly session: SessionId; readonly message: MessageId }
  | { readonly kind: "stop-run"; readonly session: SessionId; readonly run: RunId }
  | {
      readonly kind: "answer";
      readonly session: SessionId;
      readonly part: PartId;
      readonly choice: string;
      readonly typed: DraftSnapshot | null;
    }
  | {
      readonly kind: "move";
      readonly session: SessionId;
      readonly position: Position;
      readonly options: MoveOptions;
      readonly handback: DraftSnapshot | null;
    }
  | {
      readonly kind: "configure";
      readonly session: SessionId;
      readonly selection: Partial<Selection>;
    }
  | {
      readonly kind: "shell-start";
      readonly id: string;
      readonly command: string;
      readonly include: boolean;
      readonly cwd: string;
    }
  | { readonly kind: "shell-stop"; readonly id: string }
  | { readonly kind: "composer"; readonly op: ComposerOp }
  | { readonly kind: "scroll"; readonly op: ScrollOp }
  | { readonly kind: "load"; readonly dialog: DialogId; readonly request: LoadRequest }
  | {
      readonly kind: "resolve-paste";
      readonly generation: number;
      readonly text: string;
      readonly bytes: Uint8Array | null;
      readonly cwd: string;
    }
  | { readonly kind: "read-clipboard"; readonly generation: number }
  | { readonly kind: "copy"; readonly text: string }
  | { readonly kind: "open-editor"; readonly text: string; readonly command: string | null }
  | { readonly kind: "open-external"; readonly target: string }
  | { readonly kind: "write-settings"; readonly patch: SettingsPatch }
  | { readonly kind: "change-directory"; readonly session: SessionId; readonly path: string }
  | { readonly kind: "reload" }
  | { readonly kind: "compact"; readonly session: SessionId; readonly instructions: string | null }
  | { readonly kind: "self-update"; readonly version: string | null }
  | { readonly kind: "login"; readonly provider: string | null; readonly dialog: DialogId }
  | { readonly kind: "logout"; readonly provider: string }
  | { readonly kind: "notify"; readonly title: string; readonly body: string }
  | { readonly kind: "exit"; readonly code: number }
  /** Re-read git branch/dirty for the footer (after a run ends or the directory changes). */
  | { readonly kind: "refresh-workspace"; readonly cwd: string }
  /** `session.command(name, argument)` for a core-side plugin command; output comes back as `inform`. */
  | {
      readonly kind: "run-command";
      readonly session: SessionId;
      readonly name: string;
      readonly argument: string | null;
    }
  | {
      readonly kind: "stop-task";
      readonly session: SessionId;
      readonly task:
        | { readonly kind: "agent"; readonly session: SessionId }
        | { readonly kind: "job"; readonly job: string };
    }
  /** A plugin setting: `session.configure({ settings })` for session scope, `host.settings.apply` for host scope. */
  | {
      readonly kind: "apply-setting";
      readonly session: SessionId;
      readonly id: string;
      readonly scope: "host" | "session";
      readonly value: Json;
    }
  /** Answers the login step the auth dialog shows; null cancels the login. */
  | { readonly kind: "login-answer"; readonly dialog: DialogId; readonly answer: string | null }
  /** Reads an attached file's body for its preview, answered by `preview-loaded`. */
  | { readonly kind: "read-preview"; readonly marker: string; readonly path: string }
  /** `/cd` completion: list directories for the typed path, answered by `directory-listed`. */
  | { readonly kind: "list-directory"; readonly path: string; readonly cwd: string };

/** The textarea is a native renderable; the Composer attaches a port, these are its verbs. */
export type ComposerOp =
  | { readonly kind: "set"; readonly draft: DraftSnapshot }
  | { readonly kind: "insert"; readonly text: string; readonly at: "cursor" | "start" }
  | {
      readonly kind: "replace-range";
      readonly from: number;
      readonly to: number;
      readonly text: string;
    }
  | { readonly kind: "clear" }
  | { readonly kind: "focus" }
  | { readonly kind: "cursor"; readonly to: "start" | "end" };

/** The transcript scrollbox is native too; jumps resolve a row's position at call time, never from estimates. */
export type ScrollOp =
  | { readonly kind: "page"; readonly direction: -1 | 1 }
  | { readonly kind: "latest" }
  | { readonly kind: "row"; readonly key: string }
  | { readonly kind: "keep-viewport" }
  /** Ctrl+Up/Down: the previous/next turn from the one at the top of the viewport, resolved at call time. */
  | { readonly kind: "turn"; readonly direction: -1 | 1 };
