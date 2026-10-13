import type { ValidationIssue } from "./errors.ts";
import type { HeadName, ReceiptId, RunId, SessionId, WorkspaceId } from "./ids.ts";
import type { Position } from "./messages.ts";
import type { ModelRef } from "./models.ts";
import type { Json, JsonSchema } from "./primitives.ts";
import type { Execution } from "./runs.ts";
import type { Activation } from "./workspaces.ts";

/**
 * Returns one directory row: a session's identity, lineage, workspace, flags,
 * activation and heads.
 *
 * @category sessions
 * @since 0.1.0
 */
export type SessionInfo = {
  readonly id: SessionId;
  /** Null until named. */
  readonly name: string | null;
  /** The session that spawned it; null for a root. */
  readonly parent: SessionId | null;
  readonly workspace: WorkspaceId;
  readonly pinned: boolean;
  readonly archived: boolean;
  /** Whether this host is serving the session's workspace. */
  readonly activation: Activation;
  /** Every head with its tip, stack, execution and unread mark; `info()` is enough for a picker. */
  readonly heads: readonly HeadInfo[];
  readonly createdAt: number;
  readonly lastActivityAt: number;
};

/**
 * Returns one head as a directory row: tip, stack, execution and unread.
 *
 * @category sessions
 * @since 0.1.0
 */
export type HeadInfo = {
  readonly name: HeadName;
  readonly tip: Position;
  /** What `heads.create({ from })` defaults to and `heads.merge()` targets. */
  readonly stack: {
    readonly parent: HeadName;
    readonly base: Position;
    readonly stale: boolean;
  } | null;
  readonly execution: Execution;
  /** Tip !== sessions/<id>/seen/<principal>/<head>. */
  readonly unread: boolean;
};

/**
 * Returns what plugins contributed to a session: commands, settings, skills,
 * agents and tools.
 *
 * @category sessions
 * @since 0.1.0
 */
export type SessionCatalogView = {
  readonly commands: readonly CommandInfo[];
  readonly settings: readonly SettingInfo[];
  readonly skills: readonly SkillInfo[];
  readonly agents: readonly AgentInfo[];
  /** What the model can call, with deferred ones marked. */
  readonly tools: readonly ToolInfo[];
};

/**
 * Describes one command for the palette.
 *
 * @category sessions
 * @since 0.1.0
 */
export type CommandInfo = {
  /** Owner-qualified; bare names are the owner's own. */
  readonly name: string;
  readonly owner: string;
  /** Where it runs; the palette merges both. */
  readonly side: "core" | "client";
  readonly title: string;
  readonly description: string;
  /** Null = runs on pick; a schema = the palette collects it. A text command is a string schema. */
  readonly arguments: JsonSchema | null;
  readonly category?: string;
  readonly keywords?: readonly string[];
};

/**
 * Describes one setting with its schema, choices, value and the layer that
 * set it.
 *
 * @category sessions
 * @since 0.1.0
 */
export type SettingInfo = {
  readonly id: string;
  readonly owner: string;
  readonly scope: "host" | "session";
  readonly label: string;
  /** The client renders from it: enum → picker, number → field, array → list. */
  readonly schema: JsonSchema;
  /** Labels and status badges for enum schemas. */
  readonly choices:
    | readonly { readonly value: Json; readonly label: string; readonly badge?: string }[]
    | null;
  readonly value: Json;
  /** The layer that set it. */
  readonly from: "default" | "host" | "session";
};

/**
 * Describes one skill the model can load.
 *
 * @category sessions
 * @since 0.1.0
 */
export type SkillInfo = {
  readonly name: string;
  readonly owner: string;
  readonly description: string;
  /** Path or url; the model loads it on demand. */
  readonly location: string;
};

/**
 * Describes one agent preset.
 *
 * @category sessions
 * @since 0.1.0
 */
export type AgentInfo = {
  readonly id: string;
  readonly owner: string;
  readonly description: string | null;
  /** Pinned, or null = the head's. */
  readonly model: ModelRef | null;
  /** Subagent presets stay out of the user's picker. */
  readonly mode: "primary" | "subagent" | "all";
};

/**
 * Describes one tool as the session exposes it.
 *
 * @category sessions
 * @since 0.1.0
 */
export type ToolInfo = {
  readonly name: string;
  readonly owner: string;
  /** "github", "mcp/linear": groups listings and codemode's search; null when the tool names none (§48d). */
  readonly namespace: string | null;
  readonly description: string;
  readonly parameters: JsonSchema;
  readonly output: JsonSchema | null;
  readonly exposure: "model" | "deferred" | "code" | "hidden";
};

/**
 * Returns the result of running a command.
 *
 * **Outcomes**
 *
 * - `ran`: the command ran; `output` is text to show, if any.
 * - `sent`: the command produced a prompt; core sent it with source action as `receipt`.
 * - `invalid`: `args` failed the command's schema.
 * - `unknown`: no core command has this name, including client-side commands.
 * - `failed`: the command threw; `message` says why.
 *
 * @category sessions
 * @since 0.1.0
 */
export type CommandOutcome =
  | { readonly kind: "ran"; readonly output: string | null }
  | { readonly kind: "sent"; readonly receipt: ReceiptId }
  | { readonly kind: "invalid"; readonly issues: readonly ValidationIssue[] }
  | { readonly kind: "unknown" }
  | { readonly kind: "failed"; readonly message: string };

/**
 * Returns the result of updating a session's metadata.
 *
 * **Outcomes**
 *
 * - `updated`: the patch applied.
 * - `busy`: relocate while `runs` are live.
 * - `unknown-workspace`: the target workspace is not registered.
 *
 * @category sessions
 * @since 0.1.0
 */
export type UpdateOutcome =
  | { readonly kind: "updated" }
  | { readonly kind: "busy"; readonly runs: readonly RunId[] }
  | { readonly kind: "unknown-workspace" };

/**
 * Returns the result of removing a session.
 *
 * **Outcomes**
 *
 * - `removed`: the session is gone.
 * - `busy`: `runs` are live.
 * - `has-children`: remove `children` first, or archive instead.
 *
 * @category sessions
 * @since 0.1.0
 */
export type RemoveSessionOutcome =
  | { readonly kind: "removed" }
  | { readonly kind: "busy"; readonly runs: readonly RunId[] }
  | { readonly kind: "has-children"; readonly children: readonly SessionId[] };
