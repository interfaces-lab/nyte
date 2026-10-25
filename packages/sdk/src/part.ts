import { asId, isJson, SdkError } from "@nyte-ai/schema";
import type { Message, PartId, SessionId, ValidationIssue } from "@nyte-ai/schema";
import { callable, fitsActionOutput, fitsAnswer, fitsState } from "@nyte-ai/core";
import type { Part, PartDefinition, PartState } from "@nyte-ai/core";
import type { Rows } from "./rows.ts";

export function partHandle<K extends PartDefinition>(
  rows: Rows,
  session: SessionId,
  id: PartId,
  kind: K | null,
): Part<K> {
  return {
    id,
    async update(next, options) {
      const given = callable(next) ? await derived(rows, session, id, kind, next) : { value: next };

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

      if (fitsActionOutput(kind, action, absent)) return { kind: "ok", output: absent };

      if (fitsActionOutput(kind, action, outcome.output))
        return { kind: "ok", output: outcome.output };

      return { kind: "failed", message: `This handle cannot carry ${named}'s output.` };
    },
    async answer(options) {
      try {
        const answer = await rows.wait("part.answer", { session, part: id }, options);

        return answer !== null && fitsAnswer(kind, answer) ? answer : null;
      } catch (error) {
        if (options?.signal?.aborted === true) return null;

        throw error;
      }
    },
    watch: () => rows.watch("part.watch", { session, part: id }),
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

  return fitsState(kind, current.state) ? { value: next(current.state) } : null;
}

function issue(message: string): ValidationIssue {
  return { severity: "error", path: [], message };
}
