import { posix } from "node:path";
import type { ToolCallContent, ToolCallUpdate } from "@agentclientprotocol/sdk/unstable";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { toolText } from "./projection.ts";
import type { MirrorArguments } from "./projection.ts";
import type { Dialect, SubagentReport } from "./codecs/agents.ts";

export type CallResult =
  | { readonly kind: "succeeded"; readonly text: string }
  | { readonly kind: "launched"; readonly text: string }
  | { readonly kind: "failed"; readonly text: string }
  | { readonly kind: "interrupted"; readonly text: string };

export interface CallFacts {
  readonly ref: string;
  readonly native: string;
  readonly title: string;
  readonly kind: string;
  readonly input: Record<string, unknown>;
  readonly paths: readonly string[];
  readonly content: readonly ToolCallContent[];
  readonly rawOutput: unknown;
}

export type Call =
  | { readonly kind: "observed"; readonly facts: CallFacts }
  | { readonly kind: "executing"; readonly facts: CallFacts }
  | { readonly kind: "waiting-for-approval"; readonly facts: CallFacts }
  | { readonly kind: "terminal"; readonly facts: CallFacts; readonly result: CallResult };

export interface Child {
  readonly id: string;
  readonly title: string;
  readonly state: "running" | "completed" | "failed" | "unknown";
  readonly text: string;
}

const record = Type.Record(Type.String(), Type.Unknown());

export function mergeCall(
  previous: Call | undefined,
  patch: ToolCallUpdate,
  codec: Dialect,
  cwd: string,
): Call {
  if (previous?.kind === "terminal") return previous;

  const facts: CallFacts = {
    ref: previous?.facts.ref ?? crypto.randomUUID(),
    native: patch.toolCallId,
    title: patch.title ?? previous?.facts.title ?? "Tool",
    kind: patch.kind ?? previous?.facts.kind ?? "other",
    input: Value.Check(record, patch.rawInput) ? patch.rawInput : (previous?.facts.input ?? {}),
    paths: patch.locations?.map((location) => location.path) ?? previous?.facts.paths ?? [],
    content: patch.content ?? previous?.facts.content ?? [],
    rawOutput: patch.rawOutput ?? previous?.facts.rawOutput,
  };

  const merged: ToolCallUpdate = {
    ...patch,
    title: facts.title,
    rawInput: facts.input,
    kind: patch.kind ?? undefined,
  };

  const child = codec.readSubagent(merged);
  const titled = codec.readTitle(merged);

  const paths = facts.paths.toSorted(
    (left, right) => Number(inside(cwd, left)) - Number(inside(cwd, right)),
  );

  const described = {
    ...facts,
    paths,
    title: child?.title ?? titled ?? facts.title,
    kind: child === undefined ? facts.kind : "subagent",
  };

  if (patch.status !== "completed" && patch.status !== "failed") {
    return {
      kind: patch.status === "in_progress" ? "executing" : (previous?.kind ?? "observed"),
      facts: described,
    };
  }
  return {
    kind: "terminal",
    facts: described,
    result:
      patch.status === "failed"
        ? {
            kind: "failed",
            text:
              toolText(facts.content, facts.rawOutput) ||
              "The agent reported that this call failed.",
          }
        : child?.status === "running" || child?.milestone === "launched"
          ? {
              kind: "launched",
              text: "Launched in background. The child has not reported a result.",
            }
          : { kind: "succeeded", text: toolText(facts.content, facts.rawOutput) },
  };
}

export function interruptCall(call: Call): Call {
  return call.kind === "terminal"
    ? call
    : {
        kind: "terminal",
        facts: call.facts,
        result: { kind: "interrupted", text: "The agent did not report a result." },
      };
}

export function describeCall(call: Call): MirrorArguments {
  return {
    ref: call.facts.ref,
    title: call.facts.title,
    kind: call.facts.kind,
    id: call.facts.native,
    input: call.facts.input,
    paths: [...call.facts.paths],
    result:
      call.kind === "terminal"
        ? call.result
        : { kind: "interrupted", text: "The agent did not report a result." },
  };
}

export function mergeChild(previous: Child | undefined, report: SubagentReport): Child {
  if (previous?.state === "completed" || previous?.state === "failed") return previous;

  return {
    id: report.child,
    title: report.title ?? previous?.title ?? "Subagent",
    state: report.status,
    text: report.result ?? previous?.text ?? "",
  };
}

function inside(cwd: string, path: string): boolean {
  const root = posix.resolve(cwd);
  const target = posix.resolve(root, path);

  return target === root || target.startsWith(`${root}/`);
}
