import { asId, standard } from "@nyte-ai/schema";
import type { Json, RunId, SessionId } from "@nyte-ai/schema";
import { Type } from "typebox";
import { assert } from "vitest";
import { executeCall } from "../src/agent/tool-runner.ts";
import { ALL_AUTHORITY, LOCAL, isPart, tool } from "../src/index.ts";
import { callRef, decodeCallRecord, decodeRunRecord, runRef } from "../src/store.ts";
import type { Kernel } from "../src/contract/kernel.ts";
import type { ConnectionContext, Plugin, Session, ToolDefinition } from "../src/index.ts";
import type { CallRecord } from "../src/store.ts";
import { configuration, main, setup, startRun } from "../src/harness.ts";

export const caller: ConnectionContext = {
  principal: LOCAL,
  authority: ALL_AUTHORITY,
  credential: { kind: "token", token: "x" },
  origin: null,
};

export const echoes: string[] = [];

export const echo = {
  name: "echo",
  description: "Echo the text.",
  parameters: standard(Type.Object({ text: Type.String() })),
  class: () => ({ kind: "custom", label: "Echoing" }),
  replay: "safe",
  execute: async (args) => {
    echoes.push(args.text);

    return { content: [{ kind: "text", text: args.text }] };
  },
} satisfies ToolDefinition<{ text: string }>;

/** A plugin that contributes `definitions` as its tools. */
export function toolPlugin(definitions: readonly ToolDefinition[]): Plugin<"core"> {
  return { id: "test", contribute: { tools: definitions } };
}

export function slowTool(started: string[]) {
  return {
    ...echo,
    name: "slow",
    execute: (_args, invocation) =>
      new Promise((resolve) => {
        invocation.signal.addEventListener(
          "abort",
          () => resolve({ content: [{ kind: "text", text: "late" }] }),
          { once: true },
        );
        started.push(invocation.call);
      }),
  } satisfies ToolDefinition<{ text: string }>;
}

export async function liveRun(kernel: Kernel, session: SessionId): Promise<RunId> {
  const run = await startRun(
    kernel,
    session,
    main,
    { kind: "continuation", from: "wake" },
    configuration,
  );

  return run.id;
}

/** Runs a tool call on the session's plugin runtime once it has loaded the session's tools. */
export async function call(
  kernel: Kernel,
  input: {
    readonly session: SessionId;
    readonly run: RunId;
    readonly call: string;
    readonly name: string;
    readonly args: Json;
    readonly argumentsError?: string;
    readonly signal?: AbortSignal;
  },
) {
  const runtime = kernel.plugins.runtime(input.session);
  await runtime.ready;

  return executeCall(kernel, {
    session: input.session,
    runtime,
    head: main,
    run: input.run,
    call: asId(input.call),
    name: input.name,
    args: input.args,
    argumentsError: input.argumentsError,
    context: caller,
    signal: input.signal ?? new AbortController().signal,
  });
}

export async function readCall(
  kernel: Kernel,
  session: SessionId,
  id: string,
): Promise<CallRecord> {
  const ref = await kernel.store.refs.get(callRef(session, asId<"call">(id)));
  const record = decodeCallRecord(ref?.target ? await kernel.store.objects.get(ref.target) : null);
  assert(record !== null);

  return record;
}

export async function readRun(kernel: Kernel, session: SessionId, run: RunId) {
  const ref = await kernel.store.refs.get(runRef(session, run));
  const record = decodeRunRecord(ref?.target ? await kernel.store.objects.get(ref.target) : null);
  assert(ref !== null && record !== null);

  return { ref, record };
}

export function scripted(taken: string[]): NonNullable<Parameters<typeof setup>[0]>["snapshots"] {
  return {
    before: async () => {
      taken.push("before");

      return asId("s0");
    },
    after: async () => {
      taken.push("after");

      return asId(taken.length === 1 ? "s0" : "s1");
    },
    diff: async (from, to) => ({
      revision: to,
      files:
        from === asId("s0")
          ? [{ path: "a.ts", status: "modified", stat: { kind: "text", added: 3, removed: 1 } }]
          : [],
    }),
    patches: async () => [],
  };
}

export async function toolPart(session: Session, id: string) {
  const message = (await session.view()).messages.find(
    (candidate) => candidate.kind === "part" && candidate.part === asId(id),
  );

  assert(message !== undefined && isPart(message, tool));

  return message;
}
