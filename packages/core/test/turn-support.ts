import { standard } from "@nyte-ai/schema";
import { contentText } from "@nyte-ai/schema/model";
import type { DurableEvent, Infer, Message, RunId, SessionId } from "@nyte-ai/schema";
import { Type } from "typebox";
import { assert } from "vitest";
import { isPart, text } from "../src/index.ts";
import type { Kernel } from "../src/contract/kernel.ts";
import type { Plugin, ToolDefinition } from "../src/index.ts";
import type { FakeModels } from "./fake-models.ts";

export const nothing = standard(Type.Object({}));

export const ZERO_TEST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: null,
  total: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export const echo: ToolDefinition<{ readonly text: string }> = {
  name: "echo",
  description: "Echo the text.",
  parameters: standard(Type.Object({ text: Type.String() })),
  class: () => ({ kind: "custom", label: "Echoing" }),
  replay: "safe",
  execute: async (args) => ({ content: [{ kind: "text", text: `echo: ${args.text}` }] }),
};

export const nap: ToolDefinition<Infer<typeof nothing>> = {
  name: "nap",
  description: "Sleep a little.",
  parameters: nothing,
  class: () => ({ kind: "custom", label: "Napping" }),
  replay: "safe",
  async execute(_args, invocation) {
    await invocation.wait({ kind: "timer", until: invocation.now() + 100 });

    return { content: [{ kind: "text", text: "rested" }] };
  },
};

export function recorder(gate?: Promise<void>) {
  const seen: string[] = [];

  const gated: ToolDefinition<Infer<typeof nothing>> = {
    name: "wait",
    description: "Wait for the gate.",
    parameters: nothing,
    class: () => ({ kind: "custom", label: "Waiting" }),
    replay: "safe",
    async execute() {
      await gate;

      return { content: [{ kind: "text", text: "waited" }] };
    },
  };

  const plugin: Plugin<"core"> = {
    id: "recorder",
    contribute: { tools: [echo, gated] },
    hooks: {
      run_started: (view) => {
        seen.push(`run_started:${view.attempt}`);
      },
      before_request: (request) => {
        seen.push(`before_request:${request.step}:${request.attempt}`);

        return request;
      },
      after_request: (event) => {
        seen.push(`after_request:${event.step}:${event.usage.total}`);
      },
      before_compaction: (plan) => {
        seen.push(`before_compaction:${plan.reason}:${plan.summarise.length}:${plan.keep.length}`);

        return plan;
      },
      run_ended: (end) => {
        seen.push(`run_ended:${end.kind}`);
      },
    },
  };

  return { plugin, seen };
}

export function events(kernel: Kernel, session: SessionId): DurableEvent[] {
  const logged: DurableEvent[] = [];

  kernel.bus.subscribe(session, (event) => {
    if (event.kind !== "patch") logged.push(event);
  });

  return logged;
}

export function sent(fake: FakeModels, index: number): readonly string[] {
  return fake.requests[index].context.messages.map((message) => {
    switch (message.role) {
      case "system":
        return "system";
      case "user":
        return `user:${typeof message.content === "string" ? message.content : message.content.map((block) => (block.type === "text" ? block.text : "[image]")).join("")}`;
      case "assistant":
        return `assistant:${message.content.map((block) => (block.type === "text" ? block.text : block.type === "thinking" ? `(${block.thinking})` : `${block.name}()`)).join("|")}`;
      case "toolResult":
        return `result:${message.content.map((block) => (block.type === "text" ? block.text : "")).join("")}`;
    }
  });
}

export function lastUserText(fake: FakeModels, index: number): string {
  const message = fake.requests[index].context.messages.at(-1);

  assert(message?.role === "user");

  return contentText(message.content);
}

export function settledText(messages: readonly Message[]): readonly string[] {
  return messages.flatMap((message) =>
    isPart(message, text) && message.status.kind === "settled" ? [message.state.markdown] : [],
  );
}

export function landedRun(messages: readonly Message[]): RunId {
  const message = messages.find((entry) => entry.kind === "user");
  assert(
    message?.kind === "user" && message.status.kind === "landed" && message.status.run !== null,
  );

  return message.status.run;
}
