import { SdkError } from "@nyte-ai/schema";
import { closable } from "@nyte-ai/core";
import type { Login } from "@nyte-ai/core";
import type { OperationOutput } from "@nyte-ai/protocol";
import type { Rows } from "./rows.ts";

/**
 * A login streamed over `login.steps`: `begin` starts it on the host and
 * answers the key its steps and answers go by; `known` is that key when the
 * caller knows it before starting.
 */
export function loginHandle(rows: Rows, begin: () => Promise<string>, known: string | null): Login {
  let started: Promise<string> | null = null;

  return {
    steps: () =>
      closable<OperationOutput<"login.steps">>(() => {
        let steps: AsyncIterator<OperationOutput<"login.steps">> | null = null;
        let closed = false;

        return {
          async pull() {
            if (steps === null) {
              const provider = await (started ??= begin());

              if (closed) return { done: true, value: undefined };
              steps = rows.frames("login.steps", { provider })[Symbol.asyncIterator]();
            }

            return steps.next();
          },
          close() {
            closed = true;
            void steps?.return?.();
          },
        };
      }),
    async answer(code) {
      const provider = started === null ? known : await started;

      if (provider === null)
        throw new SdkError("invalid", "Read the login's steps before answering.");
      await rows.call("login.answer", { provider, code });
    },
  };
}
