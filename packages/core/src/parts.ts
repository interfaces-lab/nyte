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
  ToolPartState,
  Usage,
  ValidationIssue,
} from "@nyte-ai/schema";
import { Type } from "typebox";
import type { PluginApi } from "./plugin.ts";
import type { Durable } from "./tools.ts";

/**
 * Maps action names to their input and optional output schemas.
 *
 * @category parts
 * @since 0.1.0
 */
export type ActionSchemas = Record<string, { readonly input: Schema<unknown>; readonly output?: Schema<unknown> }>;

/**
 * Describes a kind of part: its state schema, its actions, its fallback text
 * and, optionally, the host-side logic its actions run.
 *
 * **Details**
 *
 * A part is the UI primitive: a typed, versioned state created from a
 * definition, stored as `sessions/<id>/parts/<part>`, placed somewhere in the
 * interface. Dialogs, questions, custom messages, panels, status lines and
 * generative UI are all parts with a placement. Clients register renderers
 * per kind; without one they draw the fallback.
 *
 * A definition with no `onAction` needs no owner: any side may create it
 * from the definition. A definition whose actions need host-side logic is
 * contributed by a core plugin through `contribute.parts`.
 *
 * **Example** (A question part)
 *
 * ```ts
 * import { z } from "zod";
 *
 * const question = definePart({
 *   kind: "ask/question",
 *   state: z.object({ title: z.string(), choices: z.array(z.string()) }),
 *   actions: {
 *     answer: { input: z.object({ choice: z.string() }) },
 *     dismiss: { input: z.object({}) },
 *   },
 *   fallback: (state, { id }) => `Question ${id}: ${state.title} (${state.choices.join(", ")})`,
 * });
 * ```
 *
 * @see {@link definePart}
 * @see {@link Part}
 * @category parts
 * @since 0.1.0
 */
export interface PartDefinition<State = unknown, Actions extends ActionSchemas = ActionSchemas> {
  /** Namespaced kind, e.g. "maps/places". */
  readonly kind: string;
  /** Validates the part's state; its JSON Schema goes to clients. */
  readonly state: Schema<State>;
  /** The actions a client may call with `act`. */
  readonly actions: Actions;
  /**
   * Returns the text a client without a renderer draws and the model reads.
   *
   * **Details**
   *
   * Re-projected from the current state at every request, so a part updated
   * by an action is seen updated. Put the id in the text so a follow-up tool
   * can address the part. Method syntax so a typed definition is assignable
   * to `PartDefinition`.
   *
   * **Example** (A canvas fallback)
   *
   * ```ts
   * declare const canvas: PartDefinition<{ readonly title: string; readonly error: string | null; readonly selected: string | null }>;
   *
   * const fallback: typeof canvas.fallback = (s, { id }) =>
   *   s.error !== null
   *     ? `Canvas ${id} "${s.title}" failed to render: ${s.error}`
   *     : `Canvas ${id} "${s.title}" is shown to the user (${s.selected ?? "nothing"} selected).`;
   * ```
   */
  fallback(state: State, context: { readonly id: PartId }): string;
  /**
   * Runs an action a client called and returns its value as the `act()`
   * result.
   *
   * **Details**
   *
   * An action is a function the plugin supplies and a client calls. It may
   * open further parts, wait on their answers, update its own state, and
   * return a value. Composition is ordinary code. `onAction` runs as a
   * durable task: a host restart re-runs it with its memos and nested
   * answers replayed, the same rule as a tool.
   *
   * **Gotchas**
   *
   * Without `onAction`, `act` settles `answer()` and returns
   * `{ kind: "ok", output: undefined }`.
   */
  onAction?<A extends keyof Actions>(action: A, input: Infer<Actions[A]["input"]>, context: ActionContext<State, Actions>): Awaitable<ActionOutput<Actions[A]>>;
}

/**
 * Returns an action's output type, or `undefined` when it declares none.
 *
 * @category parts
 * @since 0.1.0
 */
export type ActionOutput<S> = S extends { readonly output: Schema<infer O> } ? O : undefined;

/**
 * Returns what an action handler gets: the part, the plugin api, who acted,
 * a signal, and the durable-step primitives.
 *
 * @category parts
 * @since 0.1.0
 */
export interface ActionContext<State, Actions extends ActionSchemas> extends Durable {
  /** The part the action was called on. */
  readonly part: Part<PartDefinition<State, Actions>>;
  /** The owning plugin's api. */
  readonly api: PluginApi<"core">;
  /** Who acted. */
  readonly principal: PrincipalId;
  /** Fires when the part closes or the plugin deactivates. */
  readonly signal: AbortSignal;
}

/**
 * Returns the definition unchanged, with its state and action types
 * inferred.
 *
 * @category parts
 * @since 0.1.0
 */
export function definePart<State, const Actions extends ActionSchemas>(definition: PartDefinition<State, Actions>): PartDefinition<State, Actions> {
  return definition;
}

/**
 * Returns a definition's state type.
 *
 * @category parts
 * @since 0.1.0
 */
export type PartState<K extends PartDefinition> = Infer<K["state"]>;

/**
 * Returns a definition's actions as input and output types.
 *
 * @category parts
 * @since 0.1.0
 */
export type PartActions<K extends PartDefinition> = { readonly [A in keyof K["actions"]]: { readonly input: Infer<K["actions"][A]["input"]>; readonly output: ActionOutput<K["actions"][A]> } };

/**
 * Returns a handle on one part: update its state, act on it, wait for its
 * answer, close it.
 *
 * **Details**
 *
 * Reads are the view. A tool result embeds parts as `{ text: fallback,
 * parts: [id] }`; the model sees `fallback(state)` as it is at each request,
 * clients see the renderer. When the owning plugin unloads, its parts stay
 * readable and lose actions.
 *
 * Act is a human pressing something on a part. The model has tools; a plugin
 * that wants the model to drive its part registers a tool that calls `act`.
 *
 * **When to use**
 *
 * Core declares no modal kind. A plugin that wants to ask declares one,
 * creates it with placement modal, then waits with
 * `invocation.wait({ kind: "part" })` inside a run, or `part.answer()`
 * outside one. The harness, desktop and tui may each ship such a plugin with
 * its renderer; they are plugins, not core.
 *
 * **Example** (Asking outside a run)
 *
 * ```ts
 * declare const session: Session;
 * declare const question: PartDefinition<
 *   { readonly title: string; readonly choices: readonly string[] },
 *   { readonly answer: { readonly input: Schema<{ readonly choice: string }> }; readonly dismiss: { readonly input: Schema<{}> } }
 * >;
 *
 * const part = await session.parts.create(question, {
 *   state: { title: "Deploy to staging?", choices: ["yes", "no"] },
 *   placement: { kind: "modal" },
 * });
 * const answer = await part.answer();
 * if (answer?.action === "answer") {
 *   console.log(answer.input.choice);
 * }
 * ```
 *
 * @see {@link PartDefinition}
 * @category parts
 * @since 0.1.0
 */
export interface Part<K extends PartDefinition> {
  readonly id: PartId;
  /**
   * Replaces the state, or derives it from the current one; bumps version so
   * watchers redraw.
   *
   * **Outcomes**
   *
   * - `updated`: `version` is the new version.
   * - `invalid`: the state failed the definition's schema.
   * - `closed`: the part was closed.
   * - `missing`: no part has this id.
   *
   * @authority participant
   */
  update(next: PartState<K> | ((current: PartState<K>) => PartState<K>)): Promise<{ readonly kind: "updated"; readonly version: number } | { readonly kind: "invalid"; readonly issues: readonly ValidationIssue[] } | { readonly kind: "closed" } | { readonly kind: "missing" }>;
  /**
   * Calls an action: runs the definition's `onAction` if it has one and
   * returns its value; a definition without one settles `answer()` and
   * returns ok.
   *
   * @returns {@link ActOutcome}
   * @authority participant
   */
  act<A extends keyof PartActions<K>>(action: A, input: PartActions<K>[A]["input"]): Promise<ActOutcome<PartActions<K>[A]["output"]>>;
  /**
   * Waits for the first action, or null when dismissed.
   *
   * **Gotchas**
   *
   * On a modal part the first act settles it. On a non-modal part it
   * resolves only at close.
   *
   * @authority participant
   */
  answer(): Promise<{ readonly [A in keyof PartActions<K>]: { readonly action: A; readonly input: PartActions<K>[A]["input"] } }[keyof PartActions<K>] | null>;
  /**
   * Closes the part: a pending act resolves closed; `answer()` resolves null.
   *
   * @authority participant
   */
  close(): Promise<void>;
}

/**
 * Returns true when a message is a part of the given kind, narrowing its
 * state.
 *
 * @category views
 * @since 0.1.0
 */
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

/**
 * Returns the built-in text part: the model's prose. Role answer; streaming
 * appends and bumps version. `signature` is opaque provider continuity data
 * (a response id) the next request replays; never shown.
 *
 * **Details**
 *
 * Built-in kinds are exported with their schemas so clients narrow them like
 * any plugin's. Default renderers ship on each side; a client plugin may
 * replace one. Whether a client shows thinking, compaction or any kind is
 * the client's choice: skip the kind in its one pass. Core never hides a
 * part.
 *
 * @category parts
 * @since 0.1.0
 */
export const text: PartDefinition<{ readonly markdown: string; readonly signature: Json | null }, {}> = definePart({
  kind: "text",
  state: standard(withJson(Type.Object({ markdown: Type.String(), signature: SignatureType }))),
  actions: {},
  fallback: (state, { id }) => `${clip(state.markdown)} [${id}]`,
});

/**
 * Returns the built-in thinking part. Role step; adjacent thoughts are one
 * part, `merged` counts them, and the first id wins. `signature` is opaque
 * provider continuity data (a thinking signature, a redacted marker) the
 * next request replays; never shown.
 *
 * @category parts
 * @since 0.1.0
 */
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

/**
 * Returns the built-in tool part. Role step; its one action stops the call.
 *
 * @category parts
 * @since 0.1.0
 */
export const tool: PartDefinition<ToolPartState, { readonly stop: { readonly input: Schema<Record<string, never>> } }> = definePart({
  kind: "tool",
  state: ToolPartStateSchema,
  actions: { stop: { input: EMPTY_INPUT } },
  fallback: (state, { id }) =>
    `${clip(state.name)} ${state.phase}${state.phase === "settled" ? ` ${state.outcome.kind}` : ""} [${id}]`,
});

/**
 * Returns the built-in compaction part. Role note: context was summarised
 * here; projection to the model resumes from it.
 *
 * @category parts
 * @since 0.1.0
 */
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

/**
 * Returns the built-in branch summary part. Role note: what an abandoned
 * path was about, written by `move({ abandoned: summarize })`.
 *
 * @category parts
 * @since 0.1.0
 */
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
