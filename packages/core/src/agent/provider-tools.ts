import type { ProviderHeadRequest, ProviderToolPort } from "@nyte-ai/ai";
import { asId, isJsonObject } from "@nyte-ai/schema";
import type { ToolInfo } from "@nyte-ai/schema";
import type { Kernel, PluginRuntime } from "../contract/kernel.ts";
import { LOCAL, PARTICIPANT_AUTHORITY } from "../contract/host.ts";
import { intendedCall } from "../engine/durable.ts";
import { commit } from "../watch/commit.ts";
import { callRef } from "../store/refs.ts";
import { put, readCall } from "../store/session.ts";
import { executeCall } from "./tool-runner.ts";

export function providerTools(
  kernel: Kernel,
  runtime: PluginRuntime,
  scope: Omit<ProviderHeadRequest, "checkpoint" | "tools" | "claimContinuation">,
  offered: readonly ToolInfo[],
): ProviderToolPort {
  const operations = new Map<
    string,
    {
      readonly digest: string;
      readonly result: Promise<Awaited<ReturnType<ProviderToolPort["invoke"]>>>;
    }
  >();

  return {
    offered: async () => offered.filter((info) => info.exposure !== "hidden"),
    async invoke(input) {
      const digest = JSON.stringify({ name: input.name, args: input.args });
      const previous = operations.get(input.operation);

      if (previous !== undefined) {
        if (previous.digest !== digest) {
          return {
            kind: "failed",
            message: "This operation id already names a different tool call.",
          };
        }
        return previous.result;
      }

      const result = invoke(kernel, runtime, scope, offered, input);
      operations.set(input.operation, { digest, result });

      return result;
    },
    async authorize(input) {
      const signal = AbortSignal.any([scope.lifetime, input.signal]);
      const call = asId<"call">(`${scope.run}:provider-approval:${input.operation}`);

      const decide = () =>
        runtime.hooks.decide(
          "before_tool",
          {
            call,
            name: input.name,
            args: input.args,
            class: input.class,
          },
          { session: scope.session, head: scope.head, run: scope.run, principal: LOCAL },
          {
            call,
            run: scope.run,
            head: scope.head,
            part: null,
            signal,
          },
        );

      const wake = Promise.withResolvers<void>();
      let waiting = wake;
      const dispose = kernel.waits.onWoken(scope.session, call, () => waiting.resolve());
      const aborted = () => waiting.resolve();
      signal.addEventListener("abort", aborted, { once: true });

      const settle = async () => {
        for (;;) {
          const decided = await decide();

          if (decided.kind !== "parked" || signal.aborted) return decided;
          await waiting.promise;
          waiting = Promise.withResolvers<void>();
        }
      };

      const gated = await settle().finally(() => {
        dispose();
        signal.removeEventListener("abort", aborted);
      });

      if (signal.aborted || gated.kind !== "done") {
        return { kind: "deny", reason: "The native operation was interrupted." };
      }
      if (gated.value.action === "reject") return { kind: "deny", reason: gated.value.reason };

      return runtime.approve(
        {
          name: input.subjectName,
          class: input.class,
          scope: { head: scope.head, activity: { kind: "run", id: scope.run } },
        },
        signal,
      );
    },
  };
}

async function invoke(
  kernel: Kernel,
  runtime: PluginRuntime,
  scope: Omit<ProviderHeadRequest, "checkpoint" | "tools" | "claimContinuation">,
  offered: readonly ToolInfo[],
  input: Parameters<ProviderToolPort["invoke"]>[0],
): ReturnType<ProviderToolPort["invoke"]> {
  const signal = AbortSignal.any([scope.lifetime, input.signal]);

  if (signal.aborted) return { kind: "stopped" };

  if (!offered.some((info) => info.name === input.name && info.exposure !== "hidden")) {
    return { kind: "rejected", reason: "This tool is not offered to the agent." };
  }

  const call = asId<"call">(`${scope.run}:provider-tool:${input.operation}`);
  const intent = { name: input.name, args: input.args, principal: LOCAL, position: 0 };
  const found = await readCall(kernel.store, scope.session, call);

  if (found === null) {
    const outcome = await commit(
      kernel,
      [
        {
          name: callRef(scope.session, call),
          target: await put(
            kernel.store,
            "call",
            intendedCall({ call, run: scope.run, head: scope.head, intent }),
          ),
          expect: "absent",
        },
      ],
      { session: scope.session, run: scope.run },
    );

    if (outcome.kind !== "set") return { kind: "interrupted" };
  } else if (
    !isJsonObject(found.record.intent) ||
    JSON.stringify(found.record.intent.args) !== JSON.stringify(input.args) ||
    found.record.intent.name !== input.name
  ) {
    return { kind: "rejected", reason: "The operation conflicts with its recorded intent." };
  }

  const outcome = await executeCall(kernel, {
    session: scope.session,
    head: scope.head,
    run: scope.run,
    call,
    name: input.name,
    args: input.args,
    runtime,
    signal,
    context: {
      principal: LOCAL,
      authority: PARTICIPANT_AUTHORITY,
      origin: null,
      credential: { kind: "token", token: "" },
    },
  });

  return outcome.kind === "parked" ? { kind: "interrupted" } : outcome;
}
