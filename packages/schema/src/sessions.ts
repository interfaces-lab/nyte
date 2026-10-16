import type { ValidationIssue } from "./errors.ts";
import type { CallId, HeadName, ReceiptId, RunId, SessionId, WorkspaceId } from "./ids.ts";
import type { Position } from "./messages.ts";
import type { ModelRef } from "./models.ts";
import type { Json, JsonSchema } from "./primitives.ts";
import type { Execution } from "./runs.ts";
import type { Activation } from "./workspaces.ts";

export type SessionInfo = {
  readonly id: SessionId;
  readonly name: string | null;
  readonly parent: SessionId | null;
  readonly call: CallId | null;
  readonly workspace: WorkspaceId;
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly activation: Activation;
  readonly heads: readonly HeadInfo[];
  readonly createdAt: number;
  readonly lastActivityAt: number;
};

export type HeadInfo = {
  readonly name: HeadName;
  readonly tip: Position;
  readonly stack: {
    readonly parent: HeadName;
    readonly base: Position;
    readonly stale: boolean;
  } | null;
  readonly execution: Execution;
  readonly unread: boolean;
};

export type SessionCatalogView = {
  readonly commands: readonly CommandInfo[];
  readonly settings: readonly SettingInfo[];
  readonly skills: readonly SkillInfo[];
  readonly agents: readonly AgentInfo[];
  readonly tools: readonly ToolInfo[];
};

export type CommandInfo = {
  readonly name: string;
  readonly owner: string;
  readonly side: "core" | "client";
  readonly title: string;
  readonly description: string;
  readonly arguments: JsonSchema | null;
  readonly category?: string;
  readonly keywords?: readonly string[];
};

export type SettingInfo = {
  readonly id: string;
  readonly owner: string;
  readonly scope: "host" | "session";
  readonly label: string;
  readonly schema: JsonSchema;
  readonly choices:
    | readonly { readonly value: Json; readonly label: string; readonly badge?: string }[]
    | null;
  readonly value: Json;
  readonly from: "default" | "host" | "session";
};

export type SkillInfo = {
  readonly name: string;
  readonly owner: string;
  readonly description: string;
  readonly location: string;
};

export type AgentInfo = {
  readonly id: string;
  readonly owner: string;
  readonly description: string | null;
  readonly model: ModelRef | null;
  readonly mode: "primary" | "subagent" | "all";
};

export type ToolInfo = {
  readonly name: string;
  readonly owner: string;
  readonly namespace: string | null;
  readonly description: string;
  readonly parameters: JsonSchema;
  readonly output: JsonSchema | null;
  readonly exposure: "model" | "deferred" | "code" | "hidden";
};

export type CommandOutcome =
  | { readonly kind: "ran"; readonly output: string | null }
  | { readonly kind: "sent"; readonly receipt: ReceiptId }
  | { readonly kind: "invalid"; readonly issues: readonly ValidationIssue[] }
  | { readonly kind: "unknown" }
  | { readonly kind: "failed"; readonly message: string };

export type UpdateOutcome =
  | { readonly kind: "updated" }
  | { readonly kind: "busy"; readonly runs: readonly RunId[] }
  | { readonly kind: "unknown-workspace" };

export type RemoveSessionOutcome =
  | { readonly kind: "removed" }
  | { readonly kind: "busy"; readonly runs: readonly RunId[] }
  | { readonly kind: "has-children"; readonly children: readonly SessionId[] };
