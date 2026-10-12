import { asId } from "@nyte-ai/schema";
import type { CallId, HeadName, RunId, SessionId, WorkspaceId } from "@nyte-ai/schema";
import { createConnection } from "./connection.ts";
import { parkStep } from "./durable.ts";
import type { ExecutionEnv } from "./environment.ts";
import type { Kernel } from "./kernel.ts";
import { PARTICIPANT_AUTHORITY } from "./principals.ts";
import type { ConnectionContext } from "./principals.ts";
import { publishPatch } from "./runs.ts";
import { sessionHandle } from "./session.ts";
import { executeNested } from "./tool-runner.ts";
import type { Durable, ToolInvocation } from "./tools.ts";

/** Returns what a tool's `execute` receives, bound to where the call runs. `session` and `sdk` act from the call: the context with participant authority only and `origin` set to `{ session, run, head, call, sequence }`, `sequence` a fresh counter for this execution so its acquisitions key `acq:<n>` the same way on every re-run; `workspace` is `sdk.workspace` of the session's workspace, gated as the connection is, so its capabilities, snapshots and jobs are the session's; `env` is the environment `executeCall` resolved through `kernel.env(session)`; `progress` publishes a `progress` patch on the tool part, dropped once the run is stopping; `tools.execute` is a nested `executeNested` keyed by the caller's key or call order, whose parking parks this step too; `tools.activate` and `tools.list` are `kernel.tools(kernel.pluginsFor(session), run)`'s; `wait`, `memo` and `now` are the step's `durable`. Binds synchronously; no I/O. */
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

  const source = kernel.tools(kernel.pluginsFor(session), run);
  const sdk = createConnection(kernel, context);

  return {
    run,
    call,
    head,
    signal,
    session: sessionHandle(kernel, context, session),
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
          signal:
            options?.signal === undefined ? signal : AbortSignal.any([signal, options.signal]),
          key,
        });

        return outcome.kind === "parked" ? parkStep(durable) : outcome;
      },
      activate: (names) => source.activate(names),
      list: () => source.list(),
    },
    wait: (target) => durable.wait(target),
    memo: (name, compute) => durable.memo(name, compute),
    now: () => durable.now(),
  };
}
