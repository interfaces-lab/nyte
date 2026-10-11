import { asId, isJson } from "@nyte-ai/schema";
import type { Message, PartId, Schema, SessionId, ValidationIssue } from "@nyte-ai/schema";
import { SdkError } from "@nyte-ai/core";
import type { ActionSchemas, Part, PartActions, PartDefinition, PartState } from "@nyte-ai/core";
import type { Rows } from "./rows.ts";

type Answer<K extends PartDefinition> = NonNullable<Awaited<ReturnType<Part<K>["answer"]>>>;

/**
 * Returns a handle on a part over the `part.*` rows, typed by the
 * definition it was created from, or untyped when `kind` is null.
 *
 * `update(fn)` applies `fn` to the part's state as the main head's latest
 * view shows it (§40g), `missing` when that view does not carry the part.
 * An action's output and an answer are checked against the definition's
 * schemas; on an untyped handle an action has no output (§32), so an output
 * it cannot carry answers `failed`. `answer` is retried across link loss.
 * Binds synchronously.
 */
export function partHandle<K extends PartDefinition>(
  rows: Rows,
  session: SessionId,
  id: PartId,
  kind: K | null,
): Part<K> {
  return {
    id,
    async update(next) {
      const given = isDerivation(next)
        ? await derived(rows, session, id, kind, next)
        : { value: next };

      if (given === null) return { kind: "missing" };

      if (!isJson(given.value))
        return { kind: "invalid", issues: [issue("The state is not JSON.")] };

      return rows.call("part.update", { session, part: id, next: given.value });
    },
    async act(action, input) {
      const named = String(action);

      if (!isJson(input)) throw new SdkError("invalid", `The input of ${named} is not JSON.`);
      const outcome = await rows.call("part.act", { session, part: id, action: named, input });

      if (outcome.kind !== "ok") return outcome;
      const absent = outcome.output === null ? undefined : outcome.output;

      if (isOutputOf(kind, action, absent)) return { kind: "ok", output: absent };

      if (isOutputOf(kind, action, outcome.output)) return { kind: "ok", output: outcome.output };

      return { kind: "failed", message: `This handle cannot carry ${named}'s output.` };
    },
    async answer() {
      const answer = await rows.wait("part.answer", { session, part: id });

      return answer !== null && isAnswerOf(kind, answer) ? answer : null;
    },
    async close() {
      await rows.call("part.close", { session, part: id });
    },
  };
}

/** Returns the state `next` derives from the part's state in the main head's latest view: its non-transcript parts, then its messages; null when neither carries it or the state fails the definition's schema. */
async function derived<K extends PartDefinition>(
  rows: Rows,
  session: SessionId,
  id: PartId,
  kind: K | null,
  next: (current: PartState<K>) => PartState<K>,
): Promise<{ readonly value: unknown } | null> {
  const view = await rows.call("head.view", { session, head: asId<"head">("main") });

  const current =
    view.parts.find((part) => part.id === id) ??
    view.messages.find(
      (message): message is Extract<Message, { readonly kind: "part" }> =>
        message.kind === "part" && message.part === id,
    );

  if (current === undefined) return null;

  return isStateOf(kind, current.state) ? { value: next(current.state) } : null;
}

/** Returns whether an update derives the state from the current one rather than giving it: states are JSON, never functions. */
function isDerivation<S>(next: S | ((current: S) => S)): next is (current: S) => S {
  return typeof next === "function";
}

/** Returns whether a state is `kind`'s: what its state schema accepts; any state on an untyped handle, whose state type is unknown. */
function isStateOf<K extends PartDefinition>(
  kind: K | null,
  value: unknown,
): value is PartState<K> {
  return kind === null || accepts(kind.state, value);
}

/** Returns whether a value is what `act` answers for an action: what the action's `output` schema accepts, or undefined when it declares none or the handle is untyped. */
function isOutputOf<K extends PartDefinition, A extends keyof PartActions<K>>(
  kind: K | null,
  action: A,
  value: unknown,
): value is PartActions<K>[A]["output"] {
  const output = kind === null ? undefined : actionOf(kind, String(action))?.output;

  return output === undefined ? value === undefined : accepts(output, value);
}

/** Returns whether an answer is one of `kind`'s actions with an input its schema accepts; any answer on an untyped handle. */
function isAnswerOf<K extends PartDefinition>(
  kind: K | null,
  answer: { readonly action: PropertyKey; readonly input: unknown },
): answer is Answer<K> {
  if (kind === null) return true;
  const spec = actionOf(kind, String(answer.action));

  return spec !== undefined && accepts(spec.input, answer.input);
}

function actionOf(kind: PartDefinition, name: string): ActionSchemas[string] | undefined {
  const actions: ActionSchemas = kind.actions;

  return Object.hasOwn(actions, name) ? actions[name] : undefined;
}

function accepts(schema: Schema<unknown>, value: unknown): boolean {
  const result = schema["~standard"].validate(value);

  return !(result instanceof Promise) && result.issues === undefined;
}

function issue(message: string): ValidationIssue {
  return { severity: "error", path: [], message };
}
