import {
  JsonType,
  SignatureType,
  ToolPartStateSchema,
  UsageType,
  standard,
  withJson,
} from "@nyte-ai/schema";
import type {
  ActOutcome,
  Awaitable,
  Infer,
  Json,
  Message,
  PartId,
  PrincipalId,
  Schema,
  SessionId,
  ToolPartState,
  Usage,
  ValidationIssue,
  WaitOutcome,
} from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Kernel } from "./kernel.ts";
import type { PluginApi } from "./plugin.ts";
import { decodePartRecord } from "./records.ts";
import type { PartRecord } from "./records.ts";
import { sessionOf } from "./refs.ts";
import { load, readCall } from "./session-state.ts";
import type { Durable } from "./tools.ts";

export type ActionSchemas = Record<string, { readonly input: Schema<unknown>; readonly output?: Schema<unknown> }>;

export interface PartDefinition<State = unknown, Actions extends ActionSchemas = ActionSchemas> {
  readonly kind: string;
  readonly state: Schema<State>;
  readonly actions: Actions;
  fallback(state: State, context: { readonly id: PartId }): string;
  onAction?<A extends keyof Actions>(action: A, input: Infer<Actions[A]["input"]>, context: ActionContext<State, Actions>): Awaitable<ActionOutput<Actions[A]>>;
}

export type ActionOutput<S> = S extends { readonly output: Schema<infer O> } ? O : undefined;

export interface ActionContext<State, Actions extends ActionSchemas> extends Durable {
  readonly part: Part<PartDefinition<State, Actions>>;
  readonly api: PluginApi<"core">;
  readonly principal: PrincipalId;
  readonly signal: AbortSignal;
}

export function definePart<State, const Actions extends ActionSchemas>(definition: PartDefinition<State, Actions>): PartDefinition<State, Actions> {
  return definition;
}

export type PartState<K extends PartDefinition> = Infer<K["state"]>;

export type PartActions<K extends PartDefinition> = { readonly [A in keyof K["actions"]]: { readonly input: Infer<K["actions"][A]["input"]>; readonly output: ActionOutput<K["actions"][A]> } };

export interface Part<K extends PartDefinition> {
  readonly id: PartId;
  update(next: PartState<K> | ((current: PartState<K>) => PartState<K>)): Promise<{ readonly kind: "updated"; readonly version: number } | { readonly kind: "invalid"; readonly issues: readonly ValidationIssue[] } | { readonly kind: "closed" } | { readonly kind: "missing" }>;
  act<A extends keyof PartActions<K>>(action: A, input: PartActions<K>[A]["input"]): Promise<ActOutcome<PartActions<K>[A]["output"]>>;
  answer(): Promise<{ readonly [A in keyof PartActions<K>]: { readonly action: A; readonly input: PartActions<K>[A]["input"] } }[keyof PartActions<K>] | null>;
  close(): Promise<void>;
}

export function isPart<K extends PartDefinition>(message: Message, kind: K): message is Extract<Message, { readonly kind: "part" }> & { readonly state: PartState<K> } {
  return message.kind === "part" && message.partKind === kind.kind;
}

/** Accepts only an object with no own keys: the input of an action that takes none. */
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

export const text: PartDefinition<{ readonly markdown: string; readonly signature: Json | null }, {}> = definePart({
  kind: "text",
  state: standard(withJson(Type.Object({ markdown: Type.String(), signature: SignatureType }))),
  actions: {},
  fallback: (state, { id }) => `${clip(state.markdown)} [${id}]`,
});

export const thinking: PartDefinition<{ readonly markdown: string; readonly merged: number; readonly signature: Json | null }, {}> = definePart({
  kind: "thinking",
  state: standard(
    withJson(
      Type.Object({ markdown: Type.String(), merged: Type.Number(), signature: SignatureType }),
    ),
  ),
  actions: {},
  fallback: (state, { id }) => `Thinking (${state.merged})… [${id}]`,
});

export const tool: PartDefinition<ToolPartState, { readonly stop: { readonly input: Schema<Record<string, never>> } }> = definePart({
  kind: "tool",
  state: ToolPartStateSchema,
  actions: { stop: { input: EMPTY_INPUT } },
  fallback: (state, { id }) =>
    `${clip(state.name)} ${state.phase}${state.phase === "settled" ? ` ${state.outcome.kind}` : ""} [${id}]`,
});

export const compaction: PartDefinition<{ readonly summary: string | null; readonly material: { readonly provider: string; readonly api: string; readonly model: string; readonly data: Json } | null; readonly tokensBefore: number; readonly usage: Usage | null }, {}> = definePart({
  kind: "compaction",
  state: standard(
    withJson(
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
  actions: {},
  fallback: (state, { id }) =>
    `Context compacted at ${state.tokensBefore} tokens${state.summary !== null ? `: ${clip(state.summary)}` : state.material !== null ? ` into ${state.material.provider}/${state.material.model} material` : ""} [${id}]`,
});

export const branchSummary: PartDefinition<{ readonly markdown: string }, {}> = definePart({
  kind: "branchSummary",
  state: standard(Type.Object({ markdown: Type.String() })),
  actions: {},
  fallback: (state, { id }) => `Branch summary: ${clip(state.markdown)} [${id}]`,
});

/** Returns text as one line of at most 120 characters, an ellipsis marking a cut. */
function clip(content: string): string {
  const line = content.replace(/\s+/g, " ").trim();

  return line.length > 120 ? `${line.slice(0, 120)}…` : line;
}

/** Returns the first act on a modal part: the action's name and its input. */
export type Answered = { readonly action: string; readonly input: Json };

/** Holds what one kernel knows in memory about its parts, keyed by part ref; `answered` only ever holds an answer the store holds. */
export interface PartTable {
  readonly created: Map<string, PartDefinition>;
  readonly closed: Set<string>;
  readonly answered: Map<string, Answered>;
  readonly waiters: Map<string, Set<(answer: Answered | null) => void>>;
  readonly acting: Map<string, Set<AbortController>>;
}

export function createPartTable(): PartTable {
  return {
    created: new Map(),
    closed: new Set(),
    answered: new Map(),
    waiters: new Map(),
    acting: new Map(),
  };
}

/** Records the first answer to a modal part and resolves its waiters with it. */
export function settle(table: PartTable, name: string, answer: Answered): void {
  if (table.answered.has(name)) return;
  table.answered.set(name, answer);

  for (const resolve of table.waiters.get(name) ?? []) resolve(answer);
  table.waiters.delete(name);
}

/** Marks a part closed in memory: its waiters resolve null, its acts in flight resolve closed, and its definition and answer are dropped. */
export function release(table: PartTable, name: string): void {
  table.closed.add(name);
  table.created.delete(name);

  for (const resolve of table.waiters.get(name) ?? []) resolve(null);

  for (const controller of table.acting.get(name) ?? []) controller.abort();
  table.waiters.delete(name);
  table.acting.delete(name);
  table.answered.delete(name);
}

/** Returns the part answers among recorded outcomes, those inside an `all` included. */
export function partAnswers(outcomes: readonly (WaitOutcome | null)[]): readonly {
  readonly part: PartId;
  readonly answer: Answered;
}[] {
  return outcomes.flatMap((outcome) =>
    outcome === null
      ? []
      : outcome.kind === "all"
        ? partAnswers(outcome.outcomes)
        : outcome.kind === "part" && outcome.answer !== null
          ? [{ part: outcome.part, answer: outcome.answer }]
          : [],
  );
}

/** Returns the answer the store holds for a live part: kept on its status before a step parked (§48i), else the one recorded on the call its status names as waiting. */
export async function storedAnswer(
  kernel: Kernel,
  session: SessionId,
  record: PartRecord,
): Promise<Answered | null> {
  const status = record.status;

  if (status.kind !== "live") return null;

  if (status.answer !== undefined) return status.answer;

  if (status.waiting === undefined) return null;
  const call = (await readCall(kernel, session, status.waiting))?.record;
  const outcomes = call === undefined ? [] : [...call.waits, ...call.partial];

  return partAnswers(outcomes).find((entry) => entry.part === record.id)?.answer ?? null;
}

/** Settles each pending local `answer()` from the store, as `pollStore` runs it (§42ac): the stored answer, or null once the part is gone. */
export async function settleAnswersFrom(kernel: Kernel): Promise<void> {
  const table = kernel.partTable;

  for (const name of Array.from(table.waiters.keys())) {
    const session = sessionOf(name);
    const found = await load(kernel, await kernel.store.refs.get(name), decodePartRecord);

    if (
      session === null ||
      found === null ||
      (found.record.placement.kind === "modal" && found.record.status.kind !== "live")
    ) {
      release(table, name);

      continue;
    }

    const answer = await storedAnswer(kernel, session, found.record);

    if (answer !== null) settle(table, name, answer);
  }
}
