import type { Json } from "@nyte-ai/schema";
import type { Expectation } from "./case.ts";

/** One tool call the chat or one of its subagents made, as it settled. */
export interface Call {
  readonly by: "chat" | "subagent";
  readonly tool: string;
  readonly args: Json;
  /** The settled outcome's kind, or `unsettled` when the sample ended with the call still open. */
  readonly outcome: "ok" | "failed" | "interrupted" | "rejected" | "stopped" | "unsettled";
  readonly message: string | null;
}

/** What one sample did: its calls, the model requests of the chat's first turn, what the fixture MCP servers served and its answer. */
export interface Trace {
  readonly calls: readonly Call[];
  readonly requests: number;
  /** The model of every subagent request, as `provider/id`. */
  readonly subagents: readonly string[];
  readonly served: readonly string[];
  readonly answer: string;
}

export interface Check {
  readonly name: string;
  readonly pass: boolean;
  readonly detail: string;
}

export function grade(expect: Expectation, trace: Trace): readonly Check[] {
  const answer = trace.answer.toLowerCase();
  const rounds = expect.rounds ?? 1;
  const failed = trace.calls.filter((call) => call.by === "chat" && call.outcome !== "ok");

  return [
    {
      name: `${rounds} round${rounds === 1 ? "" : "s"} of tool calls`,
      pass: trace.requests <= rounds + 1,
      detail: `${trace.requests} model requests`,
    },
    {
      name: "every chat call ends ok",
      pass: failed.length === 0,
      detail: failed.map((call) => `${call.tool} ${call.outcome}`).join(", "),
    },
    ...(expect.calls ?? []).map((name) => {
      const made = trace.calls.filter((call) => call.tool === name);

      return {
        name: `calls ${name}`,
        pass: made.some((call) => call.outcome === "ok"),
        detail: made.length === 0 ? "never called" : made.map((call) => call.outcome).join(", "),
      };
    }),
    ...(expect.callsMustNot ?? []).map((pattern) => {
      const made = trace.calls.filter((call) => pattern.test(call.tool));

      return {
        name: `never calls ${pattern.source}`,
        pass: made.length === 0,
        detail: made.map((call) => call.tool).join(", "),
      };
    }),
    ...(expect.served ?? []).map((name) => ({
      name: `serves ${name}`,
      pass: trace.served.includes(name),
      detail: trace.served.join(", "),
    })),
    ...(expect.servedMustNot ?? []).map((server) => {
      const served = trace.served.filter((name) => name.startsWith(`${server}/`));

      return {
        name: `never serves ${server}`,
        pass: served.length === 0,
        detail: served.join(", "),
      };
    }),
    ...(expect.subagentModel === undefined
      ? []
      : [
          {
            name: `subagents run on ${expect.subagentModel}`,
            pass:
              trace.subagents.length > 0 &&
              trace.subagents.every((model) => model === expect.subagentModel),
            detail:
              trace.subagents.length === 0
                ? "no subagent"
                : [...new Set(trace.subagents)].join(", "),
          },
        ]),
    ...(expect.answer ?? []).map((needle) => ({
      name: `answers ${needle}`,
      pass: answer.includes(needle.toLowerCase()),
      detail: trace.answer.slice(0, 200),
    })),
  ];
}
