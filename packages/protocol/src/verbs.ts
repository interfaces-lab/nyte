/**
 * The verb table: every SDK verb the wire carries, its input schema, and its
 * output schema. Server and client both dispatch from this object, so a verb
 * missing here is refused by both, not silently passed through.
 *
 * The set is the one the desktop already carries over Electron IPC, plus
 * `landing`. Omitted on purpose: `runs.wait` and `runs.compact` take an
 * `AbortSignal` and hold a request open for the length of a model call;
 * `attach`, `setPlugins`, and `close` are host lifecycle, not client verbs;
 * the remaining read verbs (`messages.list`, `heads.list`, ...) wait for a
 * later revision. Step execution is never remote in this revision.
 */
import { Type } from "typebox";
import type { Static, TSchema } from "typebox";
import {
  AbortOutcome,
  ApplyOutcome,
  CancelOutcome,
  CommandInfo,
  CommandOutcome,
  ConfigureOutcome,
  FileChange,
  HeadName,
  Landing,
  ModelInfo,
  MoveOutcome,
  NonEmptyString,
  Oid,
  PluginCatalog,
  PluginInfo,
  RedeliverOutcome,
  SendReceipt,
  SessionId,
  SessionInfo,
  SessionPage,
  SessionParent,
  SessionSnapshot,
  SettingInfo,
  Skill,
  ThinkingLevel,
  UserContent,
  VcsDiff,
  WorkspaceInfo,
  list,
  optional,
  strict,
} from "./schemas.ts";

export interface VerbSpec<Input extends TSchema, Output extends TSchema> {
  readonly input: Input;
  readonly output: Output;
}

const verb = <Input extends TSchema, Output extends TSchema>(
  input: Input,
  output: Output,
): VerbSpec<Input, Output> => ({ input, output });

const nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const none = Type.Undefined();
const sessionOnly = strict({ sessionId: SessionId });
const sessionHead = strict({ sessionId: SessionId, head: Type.Optional(HeadName) });
const modelRef = strict({ provider: Type.String(), id: Type.String() });

export const VERBS = Object.freeze({
  landing: verb(none, Landing),

  "sessions.create": verb(
    optional(
      strict({
        sessionId: Type.Optional(SessionId),
        name: Type.Optional(Type.String()),
        parent: Type.Optional(SessionParent),
      }),
    ),
    SessionInfo,
  ),
  "sessions.get": verb(sessionOnly, optional(SessionInfo)),
  "sessions.snapshot": verb(sessionHead, optional(SessionSnapshot)),
  "sessions.list": verb(
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
  "sessions.rename": verb(strict({ sessionId: SessionId, name: Type.String() }), Type.Void()),
  "sessions.setPinned": verb(strict({ sessionId: SessionId, pinned: Type.Boolean() }), Type.Void()),
  "sessions.setArchived": verb(
    strict({ sessionId: SessionId, archived: Type.Boolean() }),
    Type.Void(),
  ),
  "sessions.delete": verb(sessionOnly, Type.Void()),
  "sessions.configure": verb(
    strict({
      sessionId: SessionId,
      head: Type.Optional(HeadName),
      model: Type.Optional(modelRef),
      thinkingLevel: Type.Optional(ThinkingLevel),
      agent: Type.Optional(Type.String()),
    }),
    ConfigureOutcome,
  ),

  "messages.send": verb(
    strict({
      sessionId: SessionId,
      head: Type.Optional(HeadName),
      content: UserContent,
      lane: Type.Optional(NonEmptyString),
      key: Type.Optional(Type.String()),
      agent: Type.Optional(Type.String()),
    }),
    SendReceipt,
  ),
  "messages.cancel": verb(
    strict({ sessionId: SessionId, head: Type.Optional(HeadName), change: Oid }),
    CancelOutcome,
  ),
  "messages.redeliver": verb(
    strict({
      sessionId: SessionId,
      head: Type.Optional(HeadName),
      change: Oid,
      lane: NonEmptyString,
      content: Type.Optional(UserContent),
      before: Type.Optional(nullable(Oid)),
    }),
    RedeliverOutcome,
  ),

  "runs.abort": verb(sessionHead, AbortOutcome),
  "runs.changes": verb(
    strict({
      sessionId: SessionId,
      head: Type.Optional(HeadName),
      runId: Type.Optional(Type.String()),
    }),
    list(FileChange),
  ),

  "heads.move": verb(
    strict({
      sessionId: SessionId,
      head: Type.Optional(HeadName),
      to: nullable(Oid),
      expect: Type.Optional(nullable(Oid)),
      summary: Type.Optional(strict({ customInstructions: Type.Optional(Type.String()) })),
    }),
    MoveOutcome,
  ),

  "workspace.list": verb(none, list(WorkspaceInfo)),
  "workspace.forget": verb(strict({ path: Type.String() }), Type.Void()),
  "workspace.vcs.diff": verb(
    optional(strict({ paths: Type.Optional(Type.Array(Type.String())) })),
    list(VcsDiff),
  ),

  "provider.models.default": verb(none, optional(ModelInfo)),

  "plugins.catalog": verb(none, PluginCatalog),
  "plugins.list": verb(sessionOnly, list(PluginInfo)),
  "plugins.commands.list": verb(sessionOnly, list(CommandInfo)),
  "plugins.commands.run": verb(
    strict({ sessionId: SessionId, name: Type.String(), argument: Type.Optional(Type.String()) }),
    CommandOutcome,
  ),
  "plugins.settings.list": verb(sessionOnly, list(SettingInfo)),
  "plugins.settings.apply": verb(
    strict({ sessionId: SessionId, id: Type.String(), choiceId: Type.String() }),
    ApplyOutcome,
  ),
  "plugins.resources.list": verb(sessionOnly, list(Skill)),
});

export type Verb = keyof typeof VERBS;

export type VerbInput<V extends Verb> = Static<(typeof VERBS)[V]["input"]>;
export type VerbOutput<V extends Verb> = Static<(typeof VERBS)[V]["output"]>;

/** Parse a route name without admitting inherited object properties. */
export function parseVerb(value: string): Verb | undefined {
  if (!Object.hasOwn(VERBS, value)) return undefined;
  // SAFETY: the frozen literal table cannot gain keys; the own-key check proves membership.
  return value as Verb;
}
