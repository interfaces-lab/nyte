/**
 * The operation table: every SDK operation the wire carries, its input schema, and its
 * output schema. Server and client both dispatch from this object, so an operation
 * missing here is refused by both, not silently passed through.
 *
 * The set is the one the desktop already carries over Electron IPC, plus
 * `runs.current`, `runs.reply`, `plugins.status.list`, and the share-cursor pair `workspace.current`/`workspace.select`. Omitted
 * on purpose: `runs.wait` and `runs.compact` take an `AbortSignal` and hold a
 * request open for the length of a model call; a remote client waits by
 * watching `run` events instead, and compaction stays off the wire until
 * dispatch can carry the request's signal. `attach`, `setPlugins`, and `close`
 * are host lifecycle, not client operations; the remaining read operations
 * (`messages.list`, `heads.list`, ...) wait for a later revision. Step
 * execution is never remote in this revision.
 */
import { Type, Unsafe } from "typebox";
import type { Static, TSchema } from "typebox";
import {
  AbortOutcome,
  ApplyOutcome,
  CancelOutcome,
  CommandInfo,
  CommandOutcome,
  ConfigureOutcome,
  HeadName,
  JsonValue,
  JobInfo,
  JobActionOutcome,
  MentionFile,
  MessageSource,
  ModelInfo,
  MoveOutcome,
  NonEmptyString,
  Oid,
  PluginCatalog,
  PluginInfo,
  RedeliverOutcome,
  ReplyOutcome,
  Revision,
  RunDiff,
  RunInfo,
  RunRevert,
  SendReceipt,
  SessionId,
  SessionInfo,
  SessionMetadata,
  SessionPage,
  SessionParent,
  SessionSnapshot,
  SettingInfo,
  Skill,
  ThinkingLevel,
  TreeId,
  UserContent,
  VcsBranchOutcome,
  VcsCommitOutcome,
  VcsCommitTarget,
  VcsContents,
  VcsDiff,
  VcsDiscardOutcome,
  VcsLog,
  VcsPathsOutcome,
  VcsPushOutcome,
  VcsRefs,
  VcsScope,
  VcsSnapshot,
  WorkspaceInfo,
  WorkspaceSelectInput,
  WorkspaceSelectOutcome,
  WorkspaceSelection,
  WorkspaceTarget,
  list,
  optional,
  strict,
} from "./schemas.ts";

export interface OperationSpec<Input extends TSchema, Output extends TSchema> {
  readonly input: Input;
  readonly output: Output;
}

const operation = <Input extends TSchema, Output extends TSchema>(
  input: Input,
  output: Output,
): OperationSpec<Input, Output> => ({ input, output });

const nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const none = Type.Undefined();
const sessionOnly = strict({ sessionId: SessionId });
const sessionHead = strict({ sessionId: SessionId, head: Type.Optional(HeadName) });
const modelRef = strict({ provider: Type.String(), id: Type.String() });
/** A session's directory, else the host's own workspace. */
const workspaceTarget = { target: WorkspaceTarget };
const vcsExpect = strict({ revision: Type.String() });
const vcsPaths = Unsafe<readonly [string, ...string[]]>(
  Type.Array(NonEmptyString, { minItems: 1, maxItems: 1000 }),
);
const runIds = Unsafe<readonly [string, ...string[]]>(Type.Array(Type.String(), { minItems: 1 }));

export const OPERATIONS = Object.freeze({
  "sessions.create": operation(
    optional(
      strict({
        sessionId: Type.Optional(SessionId),
        name: Type.Optional(Type.String()),
        parent: Type.Optional(SessionParent),
      }),
    ),
    SessionInfo,
  ),
  "sessions.get": operation(sessionOnly, optional(SessionInfo)),
  "sessions.snapshot": operation(sessionHead, optional(SessionSnapshot)),
  "sessions.metadata": operation(sessionHead, optional(SessionMetadata)),
  "sessions.list": operation(
    optional(
      strict({
        search: Type.Optional(Type.String()),
        limit: Type.Optional(Type.Integer({ minimum: 0 })),
        cursor: Type.Optional(Type.String()),
        parent: Type.Optional(nullable(SessionId)),
        includeArchived: Type.Optional(Type.Boolean()),
      }),
    ),
    SessionPage,
  ),
  "sessions.rename": operation(strict({ sessionId: SessionId, name: Type.String() }), Type.Void()),
  "sessions.setPinned": operation(
    strict({ sessionId: SessionId, pinned: Type.Boolean() }),
    Type.Void(),
  ),
  "sessions.setArchived": operation(
    strict({ sessionId: SessionId, archived: Type.Boolean() }),
    Type.Void(),
  ),
  "sessions.delete": operation(sessionOnly, Type.Void()),
  "sessions.configure": operation(
    strict({
      sessionId: SessionId,
      head: Type.Optional(HeadName),
      model: Type.Optional(modelRef),
      thinkingLevel: Type.Optional(ThinkingLevel),
      agent: Type.Optional(Type.String()),
    }),
    ConfigureOutcome,
  ),

  "messages.send": operation(
    strict({
      sessionId: SessionId,
      head: Type.Optional(HeadName),
      content: UserContent,
      delivery: Type.Optional(Type.Union([Type.Literal("steer"), Type.Literal("next")])),
      key: Type.Optional(Type.String()),
      agent: Type.Optional(Type.String()),
      source: Type.Optional(MessageSource),
    }),
    SendReceipt,
  ),
  "messages.cancel": operation(
    strict({ sessionId: SessionId, head: Type.Optional(HeadName), change: Oid }),
    CancelOutcome,
  ),
  "messages.redeliver": operation(
    strict({
      sessionId: SessionId,
      head: Type.Optional(HeadName),
      change: Oid,
      delivery: Type.Union([Type.Literal("steer"), Type.Literal("next")]),
      content: Type.Optional(UserContent),
      before: Type.Optional(nullable(Oid)),
    }),
    RedeliverOutcome,
  ),

  "jobs.list": operation(sessionHead, list(JobInfo)),
  /** Run the session's `bash` tool as a user-owned job: no run, no completion, a card in the client. */
  "jobs.start": operation(
    strict({ sessionId: SessionId, head: Type.Optional(HeadName), command: NonEmptyString }),
    JobInfo,
  ),
  "jobs.background": operation(
    strict({ sessionId: SessionId, jobId: Type.String() }),
    JobActionOutcome,
  ),
  "jobs.cancel": operation(
    strict({ sessionId: SessionId, jobId: Type.String() }),
    JobActionOutcome,
  ),

  "runs.current": operation(sessionHead, optional(RunInfo)),
  "runs.abort": operation(
    strict({
      sessionId: SessionId,
      head: Type.Optional(HeadName),
      // Omitted targets the current head; supplied targets only this active run.
      runId: Type.Optional(Type.String()),
    }),
    AbortOutcome,
  ),
  "runs.reply": operation(
    strict({
      sessionId: SessionId,
      head: Type.Optional(HeadName),
      runId: Type.Optional(Type.String()),
      callId: Type.String(),
      // Exact parked generation: a stale panel cannot signal its replacement.
      waitId: Oid,
      reply: JsonValue,
    }),
    ReplyOutcome,
  ),
  "runs.diff": operation(
    strict({
      sessionId: SessionId,
      head: Type.Optional(HeadName),
      runs: runIds,
    }),
    list(strict({ run: Type.String(), diff: RunDiff })),
  ),
  "runs.revert": operation(
    strict({
      sessionId: SessionId,
      head: Type.Optional(HeadName),
      runId: Type.String(),
      expect: TreeId,
    }),
    RunRevert,
  ),

  "heads.move": operation(
    strict({
      sessionId: SessionId,
      head: Type.Optional(HeadName),
      to: nullable(Oid),
      expect: Type.Optional(nullable(Oid)),
      summary: Type.Optional(strict({ customInstructions: Type.Optional(Type.String()) })),
    }),
    MoveOutcome,
  ),

  "workspace.list": operation(none, list(WorkspaceInfo)),
  "workspace.current": operation(none, WorkspaceSelection),
  "workspace.select": operation(WorkspaceSelectInput, WorkspaceSelectOutcome),
  "workspace.forget": operation(strict({ path: Type.String() }), Type.Void()),
  "workspace.vcs.snapshot": operation(strict(workspaceTarget), VcsSnapshot),
  "workspace.vcs.diff": operation(
    strict({
      ...workspaceTarget,
      scope: VcsScope,
      paths: Type.Optional(Type.Array(NonEmptyString, { maxItems: 1000 })),
      ignoreWhitespace: Type.Boolean(),
    }),
    list(VcsDiff),
  ),
  "workspace.vcs.contents": operation(
    strict({ ...workspaceTarget, scope: VcsScope, path: NonEmptyString }),
    VcsContents,
  ),
  "workspace.vcs.log": operation(
    strict({
      ...workspaceTarget,
      limit: Type.Integer({ minimum: 1, maximum: 1000 }),
      before: Type.Optional(Revision),
    }),
    VcsLog,
  ),
  "workspace.vcs.refs": operation(strict(workspaceTarget), VcsRefs),
  "workspace.vcs.stage": operation(
    strict({ ...workspaceTarget, paths: vcsPaths, staged: Type.Boolean(), expect: vcsExpect }),
    VcsPathsOutcome,
  ),
  "workspace.vcs.discard": operation(
    strict({ ...workspaceTarget, paths: vcsPaths, expect: vcsExpect }),
    VcsDiscardOutcome,
  ),
  "workspace.vcs.commit": operation(
    strict({
      ...workspaceTarget,
      message: Type.String({ minLength: 1, maxLength: 20_000, pattern: "\\S" }),
      files: VcsCommitTarget,
      expect: vcsExpect,
    }),
    VcsCommitOutcome,
  ),
  "workspace.vcs.createBranch": operation(
    strict({
      ...workspaceTarget,
      name: Type.String({ minLength: 1, maxLength: 255 }),
      checkout: Type.Boolean(),
      expect: vcsExpect,
    }),
    VcsBranchOutcome,
  ),
  "workspace.vcs.push": operation(
    strict({ ...workspaceTarget, setUpstream: Type.Boolean(), expect: vcsExpect }),
    VcsPushOutcome,
  ),
  /**
   * Files `@` can name in the workspace a session runs in. A remote client
   * cannot walk the host's filesystem, so the host both discovers and narrows:
   * `query` filters, and the host caps the reply, because a large repository's
   * whole tree is not a payload a phone should receive to show ten rows.
   */
  "workspace.files": operation(
    strict({ ...workspaceTarget, query: Type.Optional(Type.String()) }),
    list(MentionFile),
  ),

  "provider.models.list": operation(none, list(ModelInfo)),
  "provider.models.default": operation(none, optional(ModelInfo)),

  "plugins.catalog": operation(none, PluginCatalog),
  "plugins.list": operation(sessionOnly, list(PluginInfo)),
  "plugins.commands.list": operation(sessionOnly, list(CommandInfo)),
  "plugins.commands.run": operation(
    strict({ sessionId: SessionId, name: Type.String(), argument: Type.Optional(Type.String()) }),
    CommandOutcome,
  ),
  "plugins.settings.list": operation(sessionOnly, list(SettingInfo)),
  "plugins.settings.apply": operation(
    strict({ sessionId: SessionId, id: Type.String(), choiceId: Type.String() }),
    ApplyOutcome,
  ),
  "plugins.resources.list": operation(sessionOnly, list(Skill)),
  "plugins.status.list": operation(sessionOnly, list(Type.String())),
});

export type Operation = keyof typeof OPERATIONS;

export type OperationInput<V extends Operation> = Static<(typeof OPERATIONS)[V]["input"]>;
export type OperationOutput<V extends Operation> = Static<(typeof OPERATIONS)[V]["output"]>;

/** Parse a route name without admitting inherited object properties. */
export function parseOperation(value: string): Operation | undefined {
  if (!Object.hasOwn(OPERATIONS, value)) return undefined;
  // SAFETY: the frozen literal table cannot gain keys; the own-key check proves membership.
  return value as Operation;
}
