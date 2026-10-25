import {
  JsonType,
  SignatureType,
  standard,
  ToolPartStateSchema,
  UsageType,
  withJson,
} from "@nyte-ai/schema";
import type {
  ActOutcome,
  Authority,
  Awaitable,
  Disposer,
  Infer,
  Json,
  Message,
  PartId,
  PartView,
  PrincipalId,
  RequestOptions,
  Schema,
  SessionId,
  ValidationIssue,
} from "@nyte-ai/schema";
import { Type } from "typebox";
import { matchesOutput } from "../util/json-schema.ts";
import type { PluginApi } from "./plugin.ts";
import type { Durable } from "./tools.ts";

export type ActionSchemas = Record<
  string,
  { readonly input: Schema<unknown>; readonly output?: Schema<unknown> }
>;

export interface PartDefinition<State = unknown, Actions extends ActionSchemas = ActionSchemas> {
  readonly kind: string;
  readonly state: Schema<State>;
  readonly actions: Actions;
  fallback(state: State, context: { readonly id: PartId }): string;
  onAction?<A extends keyof Actions>(
    action: A,
    input: Infer<Actions[A]["input"]>,
    context: ActionContext<State, Actions>,
  ): Awaitable<ActionOutput<Actions[A]>>;
}

export type ActionOutput<S> = S extends { readonly output: Schema<infer O> } ? O : undefined;

export interface ActionContext<State, Actions extends ActionSchemas> extends Durable {
  readonly part: Part<PartDefinition<State, Actions>>;
  readonly session: SessionId;
  readonly api: PluginApi<"core">;
  readonly principal: PrincipalId;
  /** The authority the acting principal holds on this host. */
  readonly authority: ReadonlySet<Authority>;
  readonly signal: AbortSignal;
}

export function definePart<State, const Actions extends ActionSchemas>(
  definition: PartDefinition<State, Actions>,
): PartDefinition<State, Actions> {
  return definition;
}

export type PartState<K extends PartDefinition> = Infer<K["state"]>;

export type PartActions<K extends PartDefinition> = {
  readonly [A in keyof K["actions"]]: {
    readonly input: Infer<K["actions"][A]["input"]>;
    readonly output: ActionOutput<K["actions"][A]>;
  };
};

export interface Part<K extends PartDefinition> {
  readonly id: PartId;

  update(
    next: PartState<K> | ((current: PartState<K>) => PartState<K>),
    options?: { readonly version?: number },
  ): Promise<
    | { readonly kind: "updated"; readonly version: number }
    | { readonly kind: "invalid"; readonly issues: readonly ValidationIssue[] }
    | { readonly kind: "closed" }
    | { readonly kind: "missing" }
    | { readonly kind: "stale" }
  >;

  act<A extends keyof PartActions<K>>(
    action: A,
    input: PartActions<K>[A]["input"],
  ): Promise<ActOutcome<PartActions<K>[A]["output"]>>;

  answer(options?: RequestOptions): Promise<
    | {
        readonly [A in keyof PartActions<K>]: {
          readonly action: A;
          readonly input: PartActions<K>[A]["input"];
        };
      }[keyof PartActions<K>]
    | null
  >;

  /** The part's view each time it changes, wherever it sits in the session; `null` while the session holds no such part. */
  watch(): AsyncIterable<PartView | null>;

  close(): Promise<void>;
}

// oxlint-disable-next-line nyte-code/no-is-helper-names -- a public guard that @nyte-ai/plugin/client re-exports to clients
export function isPart<K extends PartDefinition>(
  message: Message,
  kind: K,
): message is Extract<Message, { readonly kind: "part" }> & { readonly state: PartState<K> } {
  return (
    message.kind === "part" &&
    message.partKind === kind.kind &&
    matchesOutput(kind.state, message.state)
  );
}

const EMPTY_INPUT: Schema<Record<string, never>> = {
  "~standard": {
    version: 1,
    vendor: "nyte",
    validate: (value) =>
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0
        ? { value: {} }
        : { issues: [{ message: "Expected an object with no keys." }] },
    jsonSchema: {
      input: () => ({ type: "object", properties: {}, additionalProperties: false }),
      output: () => ({ type: "object", properties: {}, additionalProperties: false }),
    },
  },
};

export const text = definePart({
  kind: "text",
  state: standard(
    withJson(Type.Immutable(Type.Object({ markdown: Type.String(), signature: SignatureType }))),
  ),
  actions: {},
  fallback: (state, { id }) => `${clip(state.markdown)} [${id}]`,
});

export const thinking = definePart({
  kind: "thinking",
  state: standard(
    withJson(
      Type.Immutable(
        Type.Object({ markdown: Type.String(), merged: Type.Number(), signature: SignatureType }),
      ),
    ),
  ),
  actions: {},
  fallback: (state, { id }) => `Thinking (${state.merged})… [${id}]`,
});

export const tool = definePart({
  kind: "tool",
  state: ToolPartStateSchema,
  actions: { stop: { input: EMPTY_INPUT }, background: { input: EMPTY_INPUT } },
  fallback: (state, { id }) =>
    `${clip(state.name)} ${state.phase}${state.phase === "settled" ? ` ${state.outcome.kind}` : ""} [${id}]`,
});

export const compaction = definePart({
  kind: "compaction",
  state: standard(
    withJson(
      Type.Immutable(
        Type.Object({
          summary: Type.Union([Type.String(), Type.Null()]),
          material: Type.Union([
            Type.Object({
              provider: Type.String(),
              api: Type.String(),
              model: Type.String(),
              data: JsonType,
            }),
            Type.Null(),
          ]),
          tokensBefore: Type.Number(),
          usage: Type.Union([UsageType, Type.Null()]),
        }),
      ),
    ),
  ),
  actions: {},
  fallback: (state, { id }) =>
    `Context compacted at ${state.tokensBefore} tokens${state.summary !== null ? `: ${clip(state.summary)}` : state.material !== null ? ` into ${state.material.provider}/${state.material.model} material` : ""} [${id}]`,
});

export const branchSummary = definePart({
  kind: "branchSummary",
  state: standard(Type.Immutable(Type.Object({ markdown: Type.String() }))),
  actions: {},
  fallback: (state, { id }) => `Branch summary: ${clip(state.markdown)} [${id}]`,
});

function clip(content: string): string {
  const line = content.replace(/\s+/g, " ").trim();

  return line.length > 120 ? `${line.slice(0, 120)}…` : line;
}

export type Answered = { readonly action: string; readonly input: Json };

export interface PartTable {
  readonly waiters: Map<string, Set<(answer: Answered | null) => void>>;
  readonly acting: Map<string, Set<AbortController>>;
}

export interface RegisteredDefinition {
  readonly definition: PartDefinition;
  readonly owner: string | null;
}

export interface PartDefinitions {
  get(kind: string): RegisteredDefinition | undefined;

  register(definition: PartDefinition, owner: string | null): Disposer;

  list(): readonly RegisteredDefinition[];
}
