import type { PartId } from "@nyte-ai/schema";
import { expect, it } from "vitest";
import { until } from "../src/harness.ts";
import { fakeModels, open } from "./fake-models.ts";
import { definePart } from "../src/index.ts";
import type { ActionContext, ActionOutput, ToolDefinition } from "../src/index.ts";
import { approve, echo } from "./plugin-support.ts";

type GateActions = typeof approve.actions;

async function markAllowed(
  context: ActionContext<{ readonly tool: string }, GateActions>,
): Promise<undefined> {
  await context.part.update((current) => ({ ...current, tool: `${current.tool} allowed` }));

  return undefined;
}

const marking: {
  readonly [A in keyof GateActions]: (
    context: ActionContext<{ readonly tool: string }, GateActions>,
  ) => Promise<ActionOutput<GateActions[A]>>;
} = { allow: markAllowed, deny: markAllowed };

const decided = definePart({
  ...approve,
  kind: "gate/decided",
  onAction: (action, _input, context) => marking[action](context),
});

it.each([
  ["plain", approve],
  ["handled", decided],
])(
  "runs every gated call of a step when its %s gates are answered back to back",
  async (_name, gate) => {
    const asked: PartId[] = [];
    const ran: string[] = [];
    const fake = fakeModels();

    const counted: ToolDefinition<{ text: string }> = {
      ...echo,
      execute: async (args) => {
        ran.push(args.text);

        return echo.execute(args);
      },
    };

    fake.reply(
      {
        content: ["one", "two", "three"].map((text) => ({
          type: "toolCall",
          id: text,
          name: "echo",
          arguments: { text },
        })),
      },
      { content: [{ type: "text", text: "Done." }] },
    );

    await using host = await open(fake, {
      plugins: [
        {
          id: "gate",
          contribute: {
            parts: [gate],
            tools: [counted],
          },
          hooks: {
            before_tool: async (call, context) => {
              const part = await context.api.session.parts.create(gate, {
                state: { tool: call.name },
                placement: { kind: "modal" },
              });

              if (!asked.includes(part.id)) asked.push(part.id);
              await context.wait({ kind: "part", part: part.id });

              return { action: "continue" };
            },
          },
        },
      ],
    });

    const { session, receipt } = await host.sessions.start({ content: "Echo three times." });
    await until(() => (asked.length === 3 ? asked : undefined));

    for (const part of asked) await session.part(part).act("allow", {});

    expect((await receipt.settled()).kind).toBe("completed");
    expect(ran.toSorted()).toEqual(["one", "three", "two"]);
    expect(
      fake.requests[1]?.context.messages.flatMap((message) =>
        message.role === "toolResult" ? [message.toolCallId] : [],
      ),
    ).toHaveLength(3);
  },
);
