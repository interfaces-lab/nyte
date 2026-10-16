import { asId, isJson } from "@nyte-ai/schema";
import type { Message, PartId, SessionId, ValidationIssue } from "@nyte-ai/schema";
import { SdkError, matchesOutput } from "@nyte-ai/core";
import type { ActionSchemas, Part, PartActions, PartDefinition, PartState } from "@nyte-ai/core";
import type { Rows } from "./rows.ts";

type Answer<K extends PartDefinition> = NonNullable<Awaited<ReturnType<Part<K>["answer"]>>>;

export function partHandle<K extends PartDefinition>(
  rows: Rows,
  session: SessionId,
  id: PartId,
  kind: K | null,
): Part<K> {
  return {
    id,
    async update(next, options) {
      const given = isDerivation(next)
        ? await derived(rows, session, id, kind, next)
        : { value: next };

      if (given === null) return { kind: "missing" };

      if (!isJson(given.value))
        return { kind: "invalid", issues: [issue("The state is not JSON.")] };

      return rows.call("part.update", { session, part: id, next: given.value, options });
    },
    async act(action, input) {
      const named = String(action);

      if (!isJson(input)) throw new SdkError("invalid", `The input of ${named} is not JSON.`);
      const outcome = await rows.call("part.act", { session, part: id, action: named, input });

      if (outcome.kind !== "ok") return outcome;
      const absent = outcome.output === null ? undefined : outcome.output;

      if (isPartActionOutput(kind, action, absent)) return { kind: "ok", output: absent };

      if (isPartActionOutput(kind, action, outcome.output))
        return { kind: "ok", output: outcome.output };

      return { kind: "failed", message: `This handle cannot carry ${named}'s output.` };
    },
    async answer(options) {
      try {
        const answer = await rows.wait("part.answer", { session, part: id }, options);

        return answer !== null && isPartAnswer(kind, answer) ? answer : null;
      } catch (error) {
        if (options?.signal?.aborted === true) return null;

        throw error;
      }
    },
    async close() {
      await rows.call("part.close", { session, part: id });
    },
  };
}

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

  return isPartState(kind, current.state) ? { value: next(current.state) } : null;
}

function isDerivation<S>(next: S | ((current: S) => S)): next is (current: S) => S {
  return typeof next === "function";
}

function isPartState<K extends PartDefinition>(
  kind: K | null,
  value: unknown,
): value is PartState<K> {
  return kind === null || matchesOutput(kind.state, value);
}

function isPartActionOutput<K extends PartDefinition, A extends keyof PartActions<K>>(
  kind: K | null,
  action: A,
  value: unknown,
): value is PartActions<K>[A]["output"] {
  const output = kind === null ? undefined : findAction(kind, String(action))?.output;

  return output === undefined ? value === undefined : matchesOutput(output, value);
}

function isPartAnswer<K extends PartDefinition>(
  kind: K | null,
  answer: { readonly action: PropertyKey; readonly input: unknown },
): answer is Answer<K> {
  if (kind === null) return true;
  const spec = findAction(kind, String(answer.action));

  return spec !== undefined && matchesOutput(spec.input, answer.input);
}

function findAction(kind: PartDefinition, name: string): ActionSchemas[string] | undefined {
  return Object.hasOwn(kind.actions, name) ? kind.actions[name] : undefined;
}

function issue(message: string): ValidationIssue {
  return { severity: "error", path: [], message };
}
