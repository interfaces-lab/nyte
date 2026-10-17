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
  WorkspaceId,
} from "@nyte-ai/sdk";
import type { SettingsPatch } from "../lib/settings-schema.ts";
import type { ApprovalDecision } from "@nyte-ai/plugin/approvals/schema";
import type { QuestionAnswers } from "@nyte-ai/plugin/question/schema";
import type { DialogId, LoadRequest } from "./dialogs/dialog.ts";
import type { DraftSnapshot } from "./draft.ts";
import type { QuestionTypedDraft, Selection, Submission } from "./state.ts";

/** What `/mcp` can do to one server besides signing in. */
export type McpAction = "reconnect" | "enable" | "disable" | "logout";

export type Effect =
  | {
      readonly kind: "select-account";
      readonly provider: string;
      readonly account: string;
      readonly label: string;
    }
  | { readonly kind: "follow"; readonly target: SessionId | "new"; readonly announce: boolean }
  | { readonly kind: "load-earlier"; readonly session: SessionId }
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
      readonly answers: QuestionAnswers;
      readonly typed: QuestionTypedDraft | null;
    }
  | {
      readonly kind: "approve";
      readonly session: SessionId;
      readonly part: PartId;
      readonly decision: ApprovalDecision;
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
      readonly session: SessionId | null;
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
  | {
      readonly kind: "read-dialog-clipboard";
      readonly dialog: DialogId;
      readonly promptVersion: number | null;
    }
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
  | { readonly kind: "refresh-workspace"; readonly cwd: string }
  | {
      readonly kind: "run-command";
      readonly session: SessionId;
      readonly name: string;
      readonly argument: string | null;
      readonly delivery: Delivery;
    }
  | {
      readonly kind: "stop-task";
      readonly session: SessionId;
      readonly task:
        | { readonly kind: "agent"; readonly session: SessionId }
        | { readonly kind: "job"; readonly job: string };
    }
  | {
      readonly kind: "apply-setting";
      readonly session: SessionId;
      readonly id: string;
      readonly label: string;
      readonly scope: "host" | "session";
      readonly value: Json;
    }
  | {
      readonly kind: "mcp-action";
      readonly workspace: WorkspaceId;
      readonly server: string;
      readonly action: McpAction;
    }
  | {
      readonly kind: "mcp-login";
      readonly dialog: DialogId;
      readonly workspace: WorkspaceId;
      readonly server: string;
    }
  | {
      readonly kind: "check-trust";
      readonly workspace: WorkspaceId;
      readonly ask: "always" | "if-needed";
    }
  | {
      readonly kind: "set-trust";
      readonly workspace: WorkspaceId;
      readonly value: boolean | null;
    }
  | { readonly kind: "load-folder-catalog"; readonly workspace: WorkspaceId }
  | { readonly kind: "login-answer"; readonly dialog: DialogId; readonly answer: string | null }
  | { readonly kind: "read-preview"; readonly marker: string; readonly path: string }
  | { readonly kind: "list-directory"; readonly path: string; readonly cwd: string }
  | { readonly kind: "resolve-mention"; readonly query: string; readonly cwd: string };

type ComposerOp =
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

type ScrollOp =
  | { readonly kind: "page"; readonly direction: -1 | 1 }
  | { readonly kind: "latest" }
  | { readonly kind: "row"; readonly key: string }
  | { readonly kind: "keep-viewport" }
  | { readonly kind: "turn"; readonly direction: -1 | 1 };
