import { SdkError } from "@nyte-ai/schema";
import type { SessionId } from "@nyte-ai/schema";
import type { Kernel } from "../contract/kernel.ts";
import type { RuntimeLaunchPolicy, RuntimePolicyTable } from "../contract/provider.ts";

interface Grant {
  readonly session: SessionId;
  readonly abort: AbortController;
  readonly retire: Set<() => Promise<void>>;
}

export function createRuntimePolicy(kernel: Kernel): RuntimePolicyTable {
  const grants = new Set<Grant>();
  let revision = 0;
  let changing: Promise<void> = Promise.resolve();

  const revoke: RuntimePolicyTable["revoke"] = (session) => {
    revision += 1;
    const retired = [...grants].filter((grant) => session === null || grant.session === session);
    retired.forEach((grant) => {
      grants.delete(grant);
      grant.abort.abort("policy");
    });
    const previous = changing;
    changing = Promise.all([
      previous,
      ...retired.flatMap((grant) => [...grant.retire].map((retire) => retire())),
    ]).then(() => undefined);

    return changing;
  };

  return {
    revoke,
    api: (session, owner, lifetime) => ({
      async acquire(input) {
        await changing;
        const captured = revision;
        const runtime = kernel.plugins.runtime(session);
        await runtime.ready;

        if (runtime.instance(owner)?.plugin.provider?.id !== input.provider) {
          throw new SdkError("denied", "Only the owning provider can acquire launch authority.");
        }

        const contributors = runtime
          .plugins()
          .filter((plugin) => plugin.runtimeLaunchPolicy !== undefined);

        const policies = await Promise.all(
          contributors.map(async (plugin): Promise<RuntimeLaunchPolicy> => {
            const api = runtime.instance(plugin.id)?.api;

            if (api === undefined || plugin.runtimeLaunchPolicy === undefined) {
              return { kind: "gated" };
            }
            return plugin
              .runtimeLaunchPolicy({ api, head: input.head, signal: input.signal })
              .catch(
                () =>
                  ({
                    kind: "denied",
                    reason: "The runtime launch policy could not be resolved.",
                  }) as const,
              );
          }),
        );

        const vetoWithoutConsent = runtime
          .plugins()
          .some(
            (plugin) =>
              (plugin.approve !== undefined || plugin.hooks?.before_tool !== undefined) &&
              plugin.runtimeLaunchPolicy === undefined,
          );

        const denied = policies.find((policy) => policy.kind === "denied");

        const policy: RuntimeLaunchPolicy =
          denied ??
          (policies.length > 0 &&
          !vetoWithoutConsent &&
          policies.every((policy) => policy.kind === "unattended")
            ? { kind: "unattended" }
            : { kind: "gated" });

        const grant: Grant = { session, abort: new AbortController(), retire: new Set() };
        grants.add(grant);

        const signals = AbortSignal.any([
          lifetime,
          input.signal,
          kernel.executionState.closing.signal,
        ]);

        const close = () => {
          grants.delete(grant);
          grant.abort.abort("close");
          grant.retire.forEach((retire) => {
            void retire();
          });
        };

        signals.addEventListener("abort", close, { once: true });

        if (captured !== revision || signals.aborted) close();

        return {
          policy,
          revoked: grant.abort.signal,
          onRevoke(retire) {
            if (grant.abort.signal.aborted) {
              void retire();

              return () => {};
            }

            grant.retire.add(retire);

            return () => grant.retire.delete(retire);
          },
        };
      },
    }),
  };
}
