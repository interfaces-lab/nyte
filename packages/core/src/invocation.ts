import { asId } from "@nyte-ai/schema";
import type { CallId, HeadName, RunId, SessionId, WorkspaceId } from "@nyte-ai/schema";
import { parkStep } from "./durable.ts";
import type { ExecutionEnv } from "./environment.ts";
import type { Kernel } from "./kernel.ts";
import type { PluginRuntime } from "./plugin-runtime.ts";
import { PARTICIPANT_AUTHORITY } from "./principals.ts";
import type { ConnectionContext } from "./principals.ts";
import { publishPatch } from "./runs.ts";
import { executeNested } from "./tool-runner.ts";
import type { Durable, ToolInvocation } from "./tools.ts";

export function createInvocation(
  kernel: Kernel,
  input: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly run: RunId;
    readonly call: CallId;
    readonly context: ConnectionContext;
    readonly signal: AbortSignal;
    readonly workspace: WorkspaceId;
    readonly env: ExecutionEnv;
    readonly durable: Durable;
    readonly runtime: PluginRuntime;
  },
): ToolInvocation {
  const { session, head, run, call, durable, signal } = input;
  let acquisitions = 0;
  let calls = 0;

  const context: ConnectionContext = {
    principal: input.context.principal,
    authority: PARTICIPANT_AUTHORITY,
    credential: input.context.credential,
    origin: {
      session,
      run,
      head,
      call,
      sequence: {
        next() {
          acquisitions += 1;

          return acquisitions - 1;
        },
      },
    },
  };

  const source = kernel.tools(input.runtime);
  const sdk = kernel.handles.connection(context);

  return {
    run,
    call,
    head,
    signal,
    session: kernel.handles.session(context, session),
    sdk,
    workspace: sdk.workspace(input.workspace),
    env: input.env,
    progress(update) {
      publishPatch(kernel, session, run, {
        kind: "patch",
        part: asId<"part">(call),
        progress: update,
      });
    },
    tools: {
      async execute(name, args, options) {
        const key = options?.key ?? `${calls}`;
        calls += 1;

        const outcome = await executeNested(kernel, {
          session,
          head,
          run,
          call,
          name,
          args,
          context: input.context,
          runtime: input.runtime,
          signal:
            options?.signal === undefined ? signal : AbortSignal.any([signal, options.signal]),
          key,
        });

        return outcome.kind === "parked" ? parkStep(durable) : outcome;
      },
      list: () => source.list(),
    },
    wait: (target) => durable.wait(target),
    memo: (name, compute) => durable.memo(name, compute),
    now: () => durable.now(),
  };
}
