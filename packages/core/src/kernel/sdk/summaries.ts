/**
 * Model-written summaries the SDK publishes on a participant's behalf: the
 * manual checkpoint behind `runs.compact`, and the branch summary a
 * `heads.move({ summary })` carries forward. Both convert request failures
 * into public outcomes and hand the cause to the host's diagnostic hook.
 */
import { randomUUID } from "node:crypto";
import { isTerminalPhase } from "@nyte-ai/protocol";
import type { Api, Model, Usage } from "@nyte-ai/schema";
import {
  CompactionError,
  DEFAULT_COMPACTION_SETTINGS,
  retainCompactionUsage,
  summarizeBranch,
  summaryCommit,
  writeCheckpoint,
  type SummarizeBranchInput,
  type WriteCheckpointInput,
} from "../compaction.ts";
import { branchConfig } from "@nyte-ai/client";
import { branch } from "../graph.ts";
import { hashObject } from "../hash.ts";
import type { Commit, Oid } from "../model.ts";
import { headRef } from "../names.ts";
import { collectAbandoned } from "@nyte-ai/client";
import { resolveTurnConfig, type Activation } from "./activation.ts";
import { providerCompactionFor, requestStream } from "./requests.ts";
import type { Pooled, SessionPool } from "./session-pool.ts";
import { runInfo } from "./snapshot.ts";
import {
  MAIN,
  NyteClosed,
  UnknownSession,
  type CompactOutcome,
  type HeadName,
  type MoveOutcome,
  type NyteOptions,
  type SessionId,
} from "./types.ts";

type SummaryFailure = Extract<MoveOutcome, { readonly kind: "failed" }>;

export function createSummaries(input: {
  readonly options: NyteOptions;
  readonly pool: SessionPool;
  readonly resolveModel: (ref: {
    readonly provider?: string;
    readonly id: string;
  }) => Model<Api> | undefined;
}) {
  const { options, pool, resolveModel } = input;

  const summaryFailure = async (
    operation: "runs.compact" | "heads.move",
    cause: unknown,
  ): Promise<Extract<MoveOutcome, { readonly code: "internal" }>> => {
    const failure: Extract<MoveOutcome, { readonly code: "internal" }> = {
      kind: "failed",
      code: "internal",
      message: "Internal error",
      correlationId: randomUUID(),
    };
    try {
      await options.onDiagnostic?.({ ...failure, operation, cause });
    } catch {
      // A host diagnostic failure must not replace the original outcome.
    }
    return failure;
  };

  const resolveBranchTurn = (
    activation: Activation,
    commits: readonly { readonly oid: Oid; readonly commit: Commit }[],
  ) => {
    const defaults = { model: options.model, resolveModel };
    return resolveTurnConfig(
      activation,
      options.thinkingLevel === undefined
        ? defaults
        : { ...defaults, thinkingLevel: options.thinkingLevel },
      branchConfig(commits.map((item) => item.commit)),
    );
  };

  const compact = async (input: {
    readonly sessionId: SessionId;
    readonly head?: HeadName;
    readonly customInstructions?: string;
    readonly signal?: AbortSignal;
  }): Promise<CompactOutcome> => {
    pool.alive();
    if (input.signal?.aborted) return { kind: "aborted" };
    const causes: unknown[] = [];
    try {
      const pooled = await pool.open(input.sessionId);
      const { session } = pooled;
      const head = input.head ?? MAIN;
      const running = await pool.readRun(session, head);
      if (running !== undefined && !isTerminalPhase(running.run.phase)) {
        const lease = await session.leases.read(headRef(head));
        return { kind: "busy", run: runInfo(running.run, lease) };
      }

      const tip = await session.refs.read(headRef(head));
      if (tip === null) return { kind: "nothing_to_compact" };
      const commits = await branch(session.objects, tip);
      const activation = await pool.activationFor(input.sessionId, pooled);
      if (activation === undefined) {
        return {
          kind: "failed",
          code: "inactive",
          message: "Session is not active in this host",
        };
      }
      const resolved = resolveBranchTurn(activation, commits);
      const operation = {
        head,
        runId: randomUUID(),
        sessionId: input.sessionId,
        attempt: 1,
      };
      const request = {
        hooks: activation.hooks,
        invocation: () => operation,
        streamFn: options.streamFn,
        telemetry: options.telemetry,
        errorPolicy: {
          // Preserve arbitrary thrown identity at the request boundary.
          capture: (cause: unknown) => {
            causes.push(cause);
          },
          message: "Summary request failed",
        },
        streamOptions: options.streamOptions,
      };
      let checkpoint: WriteCheckpointInput = {
        head,
        streamFn: requestStream({ ...request, step: "compaction" }),
        providerCompaction: providerCompactionFor(request),
        systemPrompt: resolved.systemPrompt,
        tools: [...resolved.tools],
        model: resolved.model,
        settings: options.compaction ?? DEFAULT_COMPACTION_SETTINGS,
        reason: "manual",
        signal: input.signal,
      };
      if (resolved.thinkingLevel !== undefined) {
        checkpoint = { ...checkpoint, thinkingLevel: resolved.thinkingLevel };
      }
      if (input.customInstructions !== undefined) {
        checkpoint = { ...checkpoint, customInstructions: input.customInstructions };
      }
      const outcome = await writeCheckpoint(session, checkpoint);
      switch (outcome.kind) {
        case "compacted":
          return { kind: "compacted", commit: outcome.commit };
        case "nothing_to_compact":
          return { kind: "nothing_to_compact" };
        case "aborted":
          return { kind: "aborted" };
        case "busy": {
          const current = await pool.currentRun(session, head);
          return current !== undefined && !isTerminalPhase(current.phase)
            ? { kind: "busy", run: current }
            : { kind: "failed", code: "busy", message: "The head is busy" };
        }
        case "failed": {
          const cause =
            causes.length === 0
              ? outcome.error
              : outcome.error instanceof CompactionError
                ? new CompactionError(
                    outcome.error.code,
                    outcome.error.message,
                    causes.length === 1
                      ? causes[0]
                      : new AggregateError(causes, "Summary requests failed"),
                    outcome.error.usage,
                  )
                : new AggregateError([outcome.error, ...causes], "Compaction failed");
          return outcome.code === "internal"
            ? summaryFailure("runs.compact", cause)
            : {
                kind: "failed",
                code: outcome.code,
                message:
                  outcome.code === "fenced"
                    ? "Checkpoint publication was fenced"
                    : "Checkpoint publication conflicted",
              };
        }
        default: {
          const _exhaustive: never = outcome;
          return _exhaustive;
        }
      }
    } catch (cause) {
      if (input.signal?.aborted) return { kind: "aborted" };
      if (cause instanceof NyteClosed || cause instanceof UnknownSession) throw cause;
      return summaryFailure(
        "runs.compact",
        causes.length === 0 ? cause : new AggregateError([cause, ...causes], "Compaction failed"),
      );
    }
  };

  /**
   * Summarize what a move from `tip` to `to` abandons into one commit whose
   * parent is the navigation target. Nothing abandoned, or an empty summary,
   * answers no oid and the move proceeds plain.
   */
  const summarizeAbandoned = async (input: {
    readonly sessionId: SessionId;
    readonly pooled: Pooled;
    readonly head: HeadName;
    readonly tip: Oid | null;
    readonly to: Oid | null;
    /** The commit the summary hangs from: where the move lands. */
    readonly parent: Oid | null;
    readonly customInstructions?: string;
  }): Promise<{ readonly kind: "summary"; readonly oid: Oid | undefined } | SummaryFailure> => {
    const { session } = input.pooled;
    const { head, tip } = input;
    let summaryOid: Oid | undefined;
    const [sourceBranch, selectedBranch] = await Promise.all([
      branch(session.objects, tip),
      branch(session.objects, input.to),
    ]);
    const byOid = new Map<Oid, Commit>();
    for (const item of [...sourceBranch, ...selectedBranch]) {
      byOid.set(item.oid, item.commit);
    }
    const abandoned = collectAbandoned(byOid, { from: tip, selected: input.to }).commits;
    if (abandoned.length > 0) {
      const activation = await pool.activationFor(input.sessionId, input.pooled);
      if (activation === undefined) {
        return {
          kind: "failed",
          code: "inactive",
          message: "Session is not active in this host",
        };
      }
      const causes: unknown[] = [];
      let summaryInput: SummarizeBranchInput;
      let unrecordedUsage: Usage | undefined;
      try {
        const resolved = resolveBranchTurn(activation, sourceBranch);
        const summaryRunId = randomUUID();
        summaryInput = {
          abandoned,
          streamFn: requestStream({
            invocation: () => ({
              head,
              runId: summaryRunId,
              sessionId: input.sessionId,
              attempt: 1,
            }),
            streamFn: options.streamFn,
            telemetry: options.telemetry,
            step: "compaction",
            errorPolicy: {
              capture: (cause) => {
                causes.push(cause);
              },
              message: "Summary request failed",
            },
          }),
          model: resolved.model,
        };
        if (resolved.thinkingLevel !== undefined) {
          summaryInput = { ...summaryInput, thinkingLevel: resolved.thinkingLevel };
        }
        if (input.customInstructions !== undefined) {
          summaryInput = {
            ...summaryInput,
            customInstructions: input.customInstructions,
          };
        }
        const summarized = await summarizeBranch(summaryInput);
        unrecordedUsage = summarized.ok ? summarized.value.usage : summarized.error.usage;
        if (!summarized.ok) {
          throw causes.length === 0
            ? summarized.error
            : new CompactionError(
                summarized.error.code,
                summarized.error.message,
                causes.length === 1
                  ? causes[0]
                  : new AggregateError(causes, "Summary requests failed"),
                summarized.error.usage,
              );
        }
        if (summarized.value.text !== "") {
          const commit = summaryCommit({
            parent: input.parent,
            body: summarized.value,
            imports: abandoned.map((item) => item.oid),
          });
          summaryOid = hashObject(commit);
          await session.objects.put([commit]);
          unrecordedUsage = undefined;
        }
        await retainCompactionUsage(session, { parent: tip, usage: unrecordedUsage });
        unrecordedUsage = undefined;
      } catch (cause) {
        try {
          await retainCompactionUsage(session, { parent: tip, usage: unrecordedUsage });
        } catch (cleanupCause) {
          return summaryFailure(
            "heads.move",
            new AggregateError([cause, cleanupCause], "Summary usage write failed"),
          );
        }
        if (cause instanceof CompactionError && cause.code !== "summarization_failed") {
          return { kind: "failed", code: cause.code, message: "Summary unavailable" };
        }
        return summaryFailure("heads.move", cause);
      }
    }
    return { kind: "summary", oid: summaryOid };
  };

  return { summaryFailure, compact, summarizeAbandoned };
}
