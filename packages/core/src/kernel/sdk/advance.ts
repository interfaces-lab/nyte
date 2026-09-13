import { listEffects, waitingBatchReady } from "../effects.ts";
import { runRef } from "../names.ts";
import type { Event, Run } from "../model.ts";
import { step, type StepOptions } from "../step.ts";
import type { Session } from "../store.ts";
import type { Turn } from "../turn.ts";
import type { AdvanceOutcome } from "./types.ts";

/** One leased kernel step, with remote cancellation observed only for its own run. */
export async function advanceStep(input: {
  readonly session: Session;
  readonly turn: Turn;
  readonly options: StepOptions;
  readonly readRun: () => Promise<Run | undefined>;
  readonly recheckJobs: (runId: string) => Promise<void>;
  readonly onRef: (event: Extract<Event, { readonly kind: "ref" }>) => Promise<void>;
}): Promise<AdvanceOutcome> {
  input.options.signal?.throwIfAborted();
  const controller = new AbortController();
  const stopWatching = new AbortController();
  const signal =
    input.options.signal === undefined
      ? controller.signal
      : AbortSignal.any([controller.signal, input.options.signal]);
  const watchSignal = AbortSignal.any([signal, stopWatching.signal]);
  let runId: string | undefined;
  let watchFailure: unknown;
  const inspect = async (): Promise<void> => {
    if (runId === undefined) return;
    const current = await input.readRun();
    if (current?.id === runId && current.abortRequested === true) controller.abort();
  };
  const afterSeq = await input.session.events.last();
  const watching = (async () => {
    for await (const event of input.session.events.watch({ afterSeq, signal: watchSignal })) {
      if (event.kind !== "ref") continue;
      await input.onRef(event);
      if (event.name === runRef(input.options.head)) await inspect();
    }
  })().catch((error: unknown) => {
    if (watchSignal.aborted) return;
    watchFailure = error;
    controller.abort();
  });
  const turn: Turn = {
    respond: async (invocation) => {
      runId = invocation.run.id;
      // A stop can arrive between the step's read and entering the turn.
      await inspect();
      return input.turn.respond(invocation);
    },
    tools: async (invocation) => {
      runId = invocation.run.id;
      await inspect();
      return input.turn.tools(invocation);
    },
  };
  try {
    const outcome = await step(input.session, turn, { ...input.options, signal });
    if (watchFailure !== undefined) throw watchFailure;
    switch (outcome.kind) {
      case "idle":
      case "continue":
      case "finished":
      case "fenced":
        return { kind: outcome.kind };
      case "busy":
        return { kind: "busy", until: outcome.holder.expiresAt };
      case "retry":
        return { kind: "retry", at: outcome.at };
      case "waiting": {
        await input.recheckJobs(outcome.run.id);
        const effects = await listEffects(input.session, outcome.run.id);
        const current = await input.readRun();
        if (waitingBatchReady(effects) || current?.abortRequested === true) {
          return { kind: "continue" };
        }
        // The step that first parks tools does not carry their deadline.
        // Read the durable effects so a scheduler can sleep immediately.
        const deadlines = effects.flatMap((view) =>
          view.effect.state === "waiting" && view.effect.until !== undefined
            ? [view.effect.until]
            : [],
        );
        return deadlines.length === 0
          ? { kind: "waiting" }
          : { kind: "waiting", until: Math.min(...deadlines) };
      }
      default: {
        const _exhaustive: never = outcome;
        return _exhaustive;
      }
    }
  } finally {
    stopWatching.abort();
    await watching;
  }
}
